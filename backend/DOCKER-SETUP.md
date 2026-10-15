# Docker Setup: Tutorials App

This guide runs the tutorials app (React frontend, Express backend and MariaDB) as three Docker containers on one EC2 host. The database is isolated on a private network, and its data is kept in a Docker volume.

- Backend repo: [devops-tutorials-client-app-backend](https://github.com/abir032/devops-tutorials-client-app-backend) (this repo, at `~/projects/nodejs-express-mysql`)
- Frontend repo: [devops-tutorials-client-app-ui](https://github.com/abir032/devops-tutorials-client-app-ui) (at `~/projects/react-tutorials-client`)

---

## 1. Architecture

```
 EC2 host (ens5 12.0.0.10)            host ports: 8080, 8081 only (no 3306)
   │ DNAT :8081 → frontend             DNAT :8080 → backend
   ▼                                   ▼
 ── web-net (bridge, NAT to internet) ─────────────────────────────
   frontend  eth0                      backend  eth0 (web-net)
                                                eth1 (db-net)
 ── db-net (--internal: no NAT, no route to the internet) ─────────
                                       db       eth0 (db-net)
                                                /var/lib/mysql             ◄── volume  db-data
                                                /docker-entrypoint-initdb.d ◄── bind mount ./db/init (read-only)
```

| Container | Image | Networks | Published port | Storage |
|---|---|---|---|---|
| `frontend` | `totorials-client:v1` | `web-net` | `8081:8081` | none |
| `backend` | `tutorials-backend:v1` | `web-net` + `db-net` | `8080:8080` | none |
| `db` | `mariadb:11.8` | `db-net` only | none | volume `db-data` and bind mount `db/init` |

Why it's laid out this way:
- The browser calls the frontend (8081) and the backend (8080) directly, so only those two ports are published.
- The DB has no published port and sits on an `--internal` network. The host can't reach it on a port, the frontend can't reach it, and the DB itself can't reach the internet.
- The backend is the only container on both networks, so it's the only way to reach the DB. It finds the DB by the name `db`, using Docker's built-in DNS.

---

## 2. Prerequisites

```bash
docker --version          # Docker Engine + Compose installed
sudo docker ps            # works with sudo

# Optional: run docker without sudo (log out and back in afterwards)
sudo usermod -aG docker ubuntu
```

---

## 3. The Dockerfiles

These are kept simple on purpose, for learning.

### Backend (`nodejs-express-mysql/Dockerfile`)
```dockerfile
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
```
`.dockerignore`:
```
node_modules
.env
db.env
db
```

### Frontend (`react-tutorials-client/Dockerfile`)
```dockerfile
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8081

CMD ["npm", "run", "dev", "--", "--host"]
```
`--host` makes Vite listen on all interfaces inside the container. Without it, Vite only listens on the container's own `localhost`, which you can't reach from outside.

`.dockerignore`:
```
node_modules
dist
```

What each instruction does:
| Instruction | Meaning |
|---|---|
| `FROM` | The base image to start from (Node 24 on Alpine Linux) |
| `WORKDIR` | The folder inside the image where the following commands run |
| `COPY package*.json` then `RUN npm install` | Install dependencies first, so Docker can reuse this layer when only the code changes |
| `COPY . .` | Copy the rest of the source code, except what `.dockerignore` excludes |
| `EXPOSE` | Documents the port. It doesn't publish anything; `-p` does that. |
| `CMD` | The command the container runs when it starts |

---

## 4. Build the images

```bash
cd ~/projects/nodejs-express-mysql
sudo docker build -t tutorials-backend:v1 .

cd ~/projects/react-tutorials-client
sudo docker build -t totorials-client:v1 .

sudo docker images
```

---

## 5. Prepare the database files

All of these live in the backend repo.

### 5.1 `db.env`: MariaDB credentials (gitignored)
```bash
cd ~/projects/nodejs-express-mysql
cp db.env.example db.env
# edit db.env:
#   MARIADB_ROOT_PASSWORD=<generate one: openssl rand -hex 16>
#   MARIADB_DATABASE=testdb
#   MARIADB_USER=<same as DB_USER in .env>
#   MARIADB_PASSWORD=<same as DB_PASSWORD in .env>
chmod 600 db.env
```
The backend's `.env` must use the same user and password (`DB_USER`, `DB_PASSWORD`, `DB_NAME=testdb`).

### 5.2 `db/init/`: scripts that run on the first start
- `db/init/01-schema.sql` creates the `tutorials` table (committed).
- `db/init/02-data.sql` is optional: existing data to import (gitignored).

To export data from an existing MariaDB/MySQL on the host:
```bash
sudo mariadb-dump --no-create-info --skip-add-locks --skip-comments testdb tutorials > db/init/02-data.sql
```

> The MariaDB image runs `/docker-entrypoint-initdb.d/*.sql` **only when the data volume is empty**, which is the first start. On every later start the scripts are skipped, and so are the settings in `db.env`.

---

## 6. Create the networks and the volume

```bash
sudo docker network create web-net             # normal bridge: NAT and published ports work
sudo docker network create --internal db-net   # private: no NAT, no internet, no published ports
sudo docker volume create db-data              # persistent storage for the DB

sudo docker network ls
sudo docker volume ls
```

---

## 7. Run the containers

Start them in this order: db, then backend, then frontend.

```bash
cd ~/projects/nodejs-express-mysql

# 1) Database: db-net only, no -p, data in a volume, init scripts bind-mounted read-only
sudo docker run -d --name db \
  --network db-net \
  --env-file db.env \
  -v db-data:/var/lib/mysql \
  -v "$PWD/db/init":/docker-entrypoint-initdb.d:ro \
  --health-cmd "healthcheck.sh --connect --innodb_initialized" --health-interval 5s \
  --restart unless-stopped \
  mariadb:11.8

# wait until it shows (healthy)
sudo docker ps

# 2) Backend: on web-net with port 8080 published, then also attached to db-net
sudo docker run -d --name backend \
  --network web-net -p 8080:8080 \
  --env-file .env -e DB_HOST=db \
  --restart unless-stopped \
  tutorials-backend:v1
sudo docker network connect db-net backend

# 3) Frontend: on web-net with port 8081 published
sudo docker run -d --name frontend \
  --network web-net -p 8081:8081 \
  --restart unless-stopped \
  totorials-client:v1
```

Flags used:
| Flag | Meaning |
|---|---|
| `-d` | Run in the background |
| `--name` | Name the container. Other containers on the same user-defined network can reach it by this name. |
| `--network` | Attach the container to a network, giving it its own `eth0` in its own network namespace |
| `-p HOST:CONTAINER` | Port forwarding: Docker adds an iptables DNAT rule from the host port to the container |
| `--env-file`, `-e` | Pass environment variables in. A later `-e` overrides a value from `--env-file`. |
| `-v NAME:/path` | Named volume |
| `-v /abs/path:/path:ro` | Bind mount, read-only |
| `--restart unless-stopped` | Start again automatically after a crash or reboot |

---

## 8. Verify

```bash
# containers and ports
sudo docker ps

# API and UI from the host
curl localhost:8080/api/tutorials
curl -I localhost:8081/

# The host must NOT listen on 3306
sudo ss -ltn | grep 3306 || echo "no 3306 on host - good"

# frontend cannot reach db (not on db-net, so the name doesn't resolve)
sudo docker exec frontend nc -zw2 db 3306 || echo "blocked - good"

# backend can reach db
sudo docker exec backend nc -zw2 db 3306 && echo "reachable - good"

# db cannot reach the internet
sudo docker exec db bash -c 'timeout 3 bash -c "</dev/tcp/1.1.1.1/443"' || echo "blocked - good"

# interfaces inside each container's network namespace
for c in db backend frontend; do
  echo "$c:"; sudo nsenter -t $(sudo docker inspect -f '{{.State.Pid}}' $c) -n ip -br addr
done

# port-forwarding rules Docker created (only 8080 and 8081)
sudo iptables -t nat -S DOCKER | grep DNAT
```

---

## 9. Access from your local machine (SSH tunnel)

The browser needs both ports: 8081 for the UI, and 8080 because the UI calls the API at `http://localhost:8080/api`.

```bash
# run on your LOCAL machine and keep it open
ssh -i /path/to/key.pem -N -L 8081:localhost:8081 -L 8080:localhost:8080 ubuntu@<EC2_PUBLIC_IP>
```
Then open **http://localhost:8081**.

The AWS security group only needs port 22 (SSH) open. Don't open 3306.

---

## 10. Linux networking: what Docker does for you

| Concept | What it is | Where you see it |
|---|---|---|
| Network namespace | A private network stack per container, with its own interfaces, routes, ports and iptables rules | `sudo lsns -t net` |
| `lo` | Loopback inside each namespace. `127.0.0.1` in a container means that container only. | `ip addr` inside the container |
| veth pair | A virtual cable. One end is the container's `eth0`, the other end is on the host. | `ip link` on the host (`veth…`) |
| Bridge | A virtual switch connecting the containers of one network (`br-…`, `docker0`) | `ip -br link show type bridge` |
| MASQUERADE (SNAT) | Containers reach the internet through the host's IP | `sudo iptables -t nat -S POSTROUTING` |
| DNAT | Port forwarding for `-p host:container` | `sudo iptables -t nat -S DOCKER` |
| FORWARD filter | Allows published ports and drops other traffic coming in from outside | `sudo iptables -S DOCKER` |
| `--internal` | A network with no MASQUERADE and no default route. It is fully private. | `sudo docker exec db cat /proc/net/route` |
| Embedded DNS | `127.0.0.11` resolves container names on user-defined networks | `sudo docker exec backend cat /etc/resolv.conf` |

> ⚠️ Ports published with `-p` bypass `ufw`, because Docker's iptables rules run first. Filter published ports with the `DOCKER-USER` chain or the AWS security group.

---

## 11. Volumes vs bind mounts

| | Named volume (`-v db-data:/var/lib/mysql`) | Bind mount (`-v $PWD/db/init:/docker-entrypoint-initdb.d:ro`) |
|---|---|---|
| Lives at | `/var/lib/docker/volumes/db-data/_data` | Any host path you choose |
| Managed by | Docker (`docker volume ls/inspect/rm`) | You |
| Best for | Data the app writes (database files) | Files you provide (config, init scripts, code during development) |
| When the container is new | An empty volume is first filled from the image's contents | The host folder hides what the image had at that path |
| Survives `docker rm` | ✅ | ✅ |

Check the mounts:
```bash
sudo docker inspect -f '{{range .Mounts}}{{.Type}}: {{.Source}} -> {{.Destination}} (rw={{.RW}}){{"\n"}}{{end}}' db
```

### Persistence test
```bash
sudo docker rm -f db          # destroy the container
sudo docker volume ls         # db-data is still there
# re-run the `docker run ... --name db ...` command from section 7
curl localhost:8080/api/tutorials   # same data; init scripts were skipped
```

| Action | Data survives? |
|---|---|
| `docker restart db` | ✅ |
| `docker rm -f db`, then run again with `-v db-data:…` | ✅ |
| Container run without a volume, then removed | ❌ |
| `docker volume rm db-data` / `docker compose down -v` | ❌ |
| EC2 instance terminated or disk lost | ❌ (the volume is on the same disk) |

**A volume is persistence, not a backup.**

---

## 12. Backup and restore

```bash
cd ~/projects/nodejs-express-mysql
R=$(grep ^MARIADB_ROOT_PASSWORD= db.env | cut -d= -f2)
mkdir -p ~/backups

# backup (a logical SQL dump)
sudo docker exec db mariadb-dump -uroot -p"$R" --single-transaction testdb > ~/backups/testdb-$(date +%F-%H%M).sql

# copy it off the machine (example)
# aws s3 cp ~/backups/ s3://<your-bucket>/tutorials/ --recursive

# restore
sudo docker exec -i db mariadb -uroot -p"$R" testdb < ~/backups/<file>.sql

# alternative: archive the raw volume (stop the db first so the files are consistent)
sudo docker stop db
sudo docker run --rm -v db-data:/data -v ~/backups:/backup alpine tar czf /backup/db-data.tgz -C /data .
sudo docker start db
```

---

## 13. Day-to-day commands

```bash
sudo docker ps                         # running containers
sudo docker logs -f backend            # follow logs (Ctrl+C to exit)
sudo docker restart frontend
sudo docker exec -it db mariadb -uappuser -p testdb    # SQL shell
sudo docker network inspect db-net     # who is attached
sudo docker stats                      # live CPU/memory per container
```

Rebuild after code changes:
```bash
cd ~/projects/nodejs-express-mysql
sudo docker build -t tutorials-backend:v1 .
sudo docker rm -f backend
# re-run the backend commands from section 7 (run + network connect)
```

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `permission denied ... docker.sock` | Use `sudo`, or add yourself to the `docker` group (section 2) |
| `port is already allocated` / `Port 8081 is already in use` | Something else holds the port. Check with `sudo ss -ltnp \| grep 8081` and stop it (`docker rm -f`, or kill the process). |
| White page in the browser | Open the browser console (F12). A 504 on `/node_modules/.vite/deps/...` means Vite's dependency cache is stale: restart the frontend container. A failed `localhost:8080` request means the tunnel isn't forwarding 8080. |
| Backend `ER_ACCESS_DENIED_ERROR` | `.env` doesn't match `db.env`. Remember `db.env` only applies on the volume's first start. |
| Backend `ENOTFOUND db` / `ECONNREFUSED` | The backend isn't on `db-net` (`docker network connect db-net backend`), or the db isn't healthy yet |
| Init scripts didn't run | The volume already has data. To start over (this **deletes all data**): `docker rm -f db && docker volume rm db-data`, then run again. |
| `docker stop` takes 10s | Node runs as PID 1 and ignores SIGTERM. Add `--init` to `docker run`. |

---

## 15. Cleanup / rollback

```bash
# remove containers (data stays in the volume)
sudo docker rm -f frontend backend db

# remove networks
sudo docker network rm web-net db-net

# remove the data volume - PERMANENT, back up first
sudo docker volume rm db-data

# go back to MariaDB installed on the host (its old data is untouched)
sudo systemctl enable --now mariadb
```

---

## 16. Next step

Section 7's long `docker run` commands can be replaced by a single `docker-compose.yml` that declares the same networks, volume, bind mount and containers, and starts them all with `docker compose up -d`.
