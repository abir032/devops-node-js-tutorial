# Tutorials App on AWS with Terraform: Summary

This setup runs the tutorials app on AWS. **Terraform** (run from a Mac) creates the network, database, storage and server. **Docker Compose** runs the app on the server. **RDS** keeps the data, and a nightly job copies the database to **S3**.

Region: `us-east-1`. Account number is shown as `<account>` below.

For the full step-by-step build, see [aws-terraform-tutorial.md](aws-terraform-tutorial.md).

---

## 1. The big picture

```
Mac ── SSH tunnel (port 22) ──▶ IGW ──▶ EC2 (public subnet 10.20.1.0/24)
                                         ├─ frontend   :8081
                                         ├─ lb (nginx) :8080 ──▶ backend-1, backend-2
                                         └─ cron → backup-db.sh
                                                  │                    │
                                         port 3306│                    │ AWS API (IAM role)
                                                  ▼                    ▼
                         RDS MariaDB (private subnets)     SSM (secrets) · S3 (backups)

Terraform on the Mac ──▶ S3 state bucket (terraform.tfstate + lock)
```

---

## 1b. The whole thing as a campus (the analogy)

Think of the setup as a **gated campus**: the app runs in one building, and the database lives in its own building run by AWS staff.

| Campus | Real thing | What it means |
|---|---|---|
| the city | AWS region `us-east-1` | where the campus is built |
| the architect | **Terraform** | draws and builds everything |
| the blueprints | the `.tf` files | the design, kept in Git |
| the architect's record book | **state file** in the state bucket | a list of what was actually built |
| the "in use" sign on the record book | `use_lockfile` | two people can't change the campus at the same time |
| the gated campus | **VPC** `10.20.0.0/16` | your own private land inside AWS |
| the zone next to the main gate | **public subnet** | can reach the street (internet) |
| the back zone with no street | **private subnets** | no road out at all |
| the main gate | **Internet Gateway** | the only way in or out |
| signposts | **route tables** | "street → this way" (public) or no sign at all (private) |
| a guard at a door with a guest list | **security group** | who may enter, on which door (port) |
| the office building | **EC2** | where your app works |
| the moving-in checklist on day one | **user_data** | install Docker, AWS CLI and swap on first boot |
| your personal key to the side door | SSH key `~/.ssh/tutorials-ec2` | only you can come in, through door 22 |
| a private corridor from your home to the building | **SSH tunnel** | `localhost:8081` on the Mac = door 8081 on the EC2 |
| floors inside the building | **containers** | frontend, lb, backend-1, backend-2 |
| the shared lobby | `web-net` | the floors find each other by name |
| entrance signs | `-p 8080:80`, `8081:8081` | door number on the building → room on a floor |
| the receptionist | **nginx** | sends each visitor to clerk 1 or clerk 2 |
| two clerks | **backend-1, backend-2** | do the work, talk to the archive |
| a separate archive building, run by AWS staff | **RDS** | AWS repairs it, patches it and keeps a 1-day backup |
| the plots where the archive may stand | **DB subnet group** | the two private zones (AZ a and AZ b) |
| the archive manager | `dbadmin` | can do everything: make shelves, make passes |
| a clerk's limited pass | `appuser` | may read and change files only, not rebuild the archive |
| the locked key cabinet | **SSM Parameter Store** | holds the archive's address and passwords |
| a staff ID badge | **IAM role** | lets the building open the key cabinet and the vault, nothing else |
| the off-site storage vault | **S3 backup bucket** | copies of the archive, outside every building |
| the vault keeps old copies | versioning | a replaced copy can still be recovered |
| the vault shreds old copies | lifecycle rule | deleted after 30 days |
| the night watchman with an alarm clock | **cron** | starts the job at 02:00 local time |
| the clerk who photocopies the archive and carries it to the vault | **backup-db.sh** | dump → gzip → S3 |
| a fire drill | **restore test** | prove the copy can really rebuild the archive |
| demolish / rebuild from the same blueprint | `terraform destroy` / `terraform apply` | the campus comes back the same, but empty |

**The story in one paragraph:** the architect (Terraform) builds a gated campus (VPC) from blueprints and writes everything in a record book kept in a separate safe (the state bucket). Near the main gate (IGW) stands the office building (EC2). A guard (security group) only lets **you** in, with your own key, through a private corridor (SSH tunnel). Inside, the receptionist (nginx) sends each visitor to one of two clerks (backends). In the back zone, which has no street at all, stands the archive building (RDS). Its guard only lets in people coming from the office building, on door 3306. The office building wears a staff badge (IAM role), which opens the key cabinet (SSM) for the archive's address and password. Every night the watchman (cron) wakes a clerk (backup script), who photocopies the archive and carries the copy to the off-site vault (S3). A fire drill (restore test) proves the copy works.

---

## 2. Where each thing runs

| Where | What runs there | Who manages it |
|---|---|---|
| **Mac** | `terraform`, `aws` CLI, the SSH key `~/.ssh/tutorials-ec2`, the browser (via the tunnel) | you |
| **AWS (managed services)** | VPC, subnets, IGW, route tables, security groups, RDS, S3, SSM, IAM | AWS runs them; Terraform creates them |
| **EC2** (Ubuntu 24.04, t3.micro) | Docker, Docker Compose, the AWS CLI, `mariadb` client, cron, the backup script | you (set up by user_data + Step 7) |
| **Containers on the EC2** | `frontend`, `lb` (nginx), `backend-1`, `backend-2` on network `web-net` | Docker Compose |
| **RDS** (private subnet) | MariaDB 11.4, database `testdb` | AWS (patching, storage, automatic backups) |
| **S3** | backup files, Terraform state | AWS |

---

## 3. Step by step

### Step 0: state bucket (by hand, on the Mac)
Terraform needs somewhere to keep its memory (the state file) **before** it can build anything, so this one bucket is made by hand:

```bash
aws s3api create-bucket --bucket tutorials-tfstate-<account> --region us-east-1
aws s3api put-bucket-versioning --bucket tutorials-tfstate-<account> --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket tutorials-tfstate-<account> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket tutorials-tfstate-<account> --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

It is **not** deleted by `terraform destroy`.

> **Analogy:** before the architect can build, they need a safe place for the record book. You set up that safe by hand.

### Step 1: project, providers, variables (Mac: `~/projects/tutorials-infra/infra`)
| File | What it holds |
|---|---|
| `versions.tf` | Terraform ≥ 1.10, AWS provider `~> 6.0`, random `~> 3.6`, the S3 backend with `use_lockfile = true` |
| `providers.tf` | region + `default_tags` (Project = tutorials, ManagedBy = terraform) on every resource |
| `variables.tf` | `project`, `region`, `my_ip` (must be `/32`), `ssh_public_key_path` |
| `terraform.tfvars` | your real IP (**gitignored**) |
| `.gitignore` | `.terraform/`, state files, `*.tfvars`, keys, plans |

SSH key made on the Mac (not by Terraform, so the private key never lands in state):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/tutorials-ec2 -C "tutorials-ec2"
```

### Step 2: network (`network.tf`, 10 resources)
| Resource | Value |
|---|---|
| VPC | `10.20.0.0/16`, DNS on |
| Public subnet | `10.20.1.0/24`, AZ a, public IPs on launch |
| Private subnets | `10.20.11.0/24` (AZ a), `10.20.12.0/24` (AZ b) |
| Internet Gateway | the way out to the internet |
| Public route table | `0.0.0.0/0 → IGW` |
| Private route table | **no routes**: the private subnets can't reach the internet (no NAT, saves money) |

> **Analogy:** fence the campus, mark a front zone by the main gate and two back zones, then put up the signposts: "street → this way" in front, no sign at all in the back.

### Step 3: security groups (`security.tf`, 5 resources)
| Group | Rule |
|---|---|
| `app` (EC2) | **in:** port 22 from your IP `/32` only · **out:** everything |
| `db` (RDS) | **in:** port 3306 only from the `app` group · no outbound rules |

Ports 8080 and 8081 are **not** open to the internet. They are reached through the SSH tunnel.

> **Analogy:** two guards. The office guard lets in only **you**, at door 22. The archive guard lets in only people **from the office building**, at door 3306.

### Step 4: backup bucket (`storage.tf`, 5 resources)
See section 4 below.

### Step 5: database (`database.tf`, 7 resources)
See section 5 below.

### Step 6: server (`compute.tf` + `user_data.sh`, 5 resources)
| Resource | What it does |
|---|---|
| Key pair | uploads your **public** key |
| IAM role + policy + instance profile | the server's "badge": read SSM `/tutorials/*`, list/put/get in the backup bucket only |
| EC2 `t3.micro` | Ubuntu 24.04 (AMI from the SSM public parameter), 20 GB encrypted gp3, IMDSv2 required |

`user_data.sh` runs **once, as root, on first boot**: 2 GB swap, `curl git jq mariadb-client`, Docker from Docker's apt repo, the Compose plugin, `ubuntu` added to the `docker` group, the AWS CLI (snap), region set, then the marker `/var/tmp/user-data-done`.

> **Analogy:** put up the office building, hand it a staff badge (IAM role), fit your lock on the side door (key pair), and leave a moving-in checklist (user_data) that runs the first time the lights come on.

Check after first boot:
```bash
cloud-init status --wait
cat /var/tmp/user-data-done
groups            # must include docker
aws sts get-caller-identity   # shows assumed-role/tutorials-app-role
```

### Step 7: deploy the app (on the EC2, by hand)
1. Add a GitHub SSH key on the EC2 (`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`), then clone:
   - `~/projects/devops-tutorials-client-app-backend`
   - `~/projects/devops-tutorials-client-app-ui`
2. Read the RDS address and passwords from SSM into shell variables.
3. Load the schema and create `appuser` in RDS (section 5).
4. Write the backend `.env` from SSM values (`chmod 600`, never committed):
   ```
   DB_HOST=<rds endpoint>
   DB_USER=appuser
   DB_PASSWORD=<app password from SSM>
   DB_NAME=testdb
   ```
5. Write `~/projects/tutorials-stack/docker-compose.yml` (backend × 2, `lb` nginx on `8080:80`, `frontend` on `8081`, one network `web-net`) and `nginx.conf` (`upstream backends { server backend:8080; }` + `X-Served-By` header).
6. Build and start:
   ```bash
   docker build -t tutorials-backend:aws ../devops-tutorials-client-app-backend
   docker build -t tutorials-client:aws ../devops-tutorials-client-app-ui
   docker compose up -d
   ```
7. Test: a POST creates a row in RDS, `X-Served-By` shows both backends, and the browser works through the tunnel:
   ```bash
   ssh -i ~/.ssh/tutorials-ec2 -N -L 8081:localhost:8081 -L 8080:localhost:8080 ubuntu@<EC2 IP>
   ```
   Then open `http://localhost:8081`.

> **Analogy:** the building is empty, so you move in. Bring the furniture (clone the code). Use the badge to open the key cabinet (SSM). Set up shelves in the archive and give the clerks a limited pass (schema + `appuser`). Pin the archive's address and pass in the clerks' office (`.env`). Then open the floors: the receptionist and the two clerks (Compose).

### Step 8: backups to S3 (on the EC2)
Script `~/bin/backup-db.sh`, cron job and restore test. See section 4.

> **Analogy:** hire a night watchman (cron) who wakes a clerk at 02:00 to photocopy the archive and carry the copy to the off-site vault (S3). Then hold a fire drill (restore test).

### Step 9: final check and destroy
```bash
terraform plan -destroy
terraform destroy
```

> **Analogy:** demolish the campus. The safe with the record book (state bucket) stays, so the architect can rebuild from the same blueprints any day.

---

## 4. S3

> **Analogy:** S3 holds two separate safes. One is the **architect's record office** (state). The other is the **off-site vault** for photocopies of the archive (backups).

There are **two buckets**, with different jobs:

| Bucket | Made by | Job | Deleted by `destroy`? |
|---|---|---|---|
| `tutorials-tfstate-<account>` | hand (Step 0) | Terraform's state file + lock | **no** |
| `tutorials-backups-<account>` | Terraform (Step 4) | database backups | yes (`force_destroy = true`) |

### Backup bucket settings (Terraform)
| Setting | Value | Why |
|---|---|---|
| Public access block | all 4 on | nothing can ever be made public |
| Encryption | SSE AES256 | files are encrypted at rest |
| Versioning | Enabled | an overwritten or deleted file can be recovered |
| Lifecycle `expire-old-backups` | delete after **30 days**; old versions after 7 days; failed uploads after 1 day | storage cost stays small |

### Backup script `~/bin/backup-db.sh`
What it does, in order:
1. sets `PATH` (adds `/snap/bin`) and the region, because cron starts with almost nothing
2. finds the account number (`aws sts get-caller-identity`) → bucket name
3. reads the RDS address + app password from **SSM** (using the IAM role, no keys)
4. `mariadb-dump --single-transaction --no-tablespaces testdb | gzip` → temp file
5. `aws s3 cp` → `s3://tutorials-backups-<account>/mariadb/testdb_YYYY-MM-DD_HHMM.sql.gz`
6. deletes the temp file (`trap ... EXIT`) and prints one `backup ok` line

### Cron
```
0 20 * * * /home/ubuntu/bin/backup-db.sh >> /home/ubuntu/backup.log 2>&1
```
20:00 UTC every day (02:00 at UTC+6; change the hour for your time zone). Output goes to `~/backup.log`.

### Checks
```bash
aws s3 ls s3://tutorials-backups-<account>/mariadb/     # backup files listed
aws s3 ls                                               # AccessDenied: least privilege works
aws s3 cp s3://.../<file> - | gunzip | grep -A5 "INSERT INTO"   # rows inside the backup
```

### Restore test
```bash
mariadb ... -u dbadmin -e "CREATE DATABASE testdb_restore;"
aws s3 cp s3://.../<latest> - | gunzip | mariadb ... -u dbadmin testdb_restore
# compare COUNT(*) of testdb.tutorials and testdb_restore.tutorials → same
mariadb ... -u dbadmin -e "DROP DATABASE testdb_restore;"
```
This proves the backup can actually bring the data back.

---

## 5. RDS

> **Analogy:** RDS is the archive building in the back zone. AWS staff run the building: repairs, patching and a 1-day backup. **You** decide what goes on the shelves and who gets which pass.

### What Terraform created
| Setting | Value |
|---|---|
| Engine | MariaDB 11.4, `db.t4g.micro` |
| Storage | 20 GB gp3, encrypted |
| Placement | DB subnet group = the 2 private subnets; `publicly_accessible = false` |
| Firewall | security group `db`: 3306 from `app` only |
| High availability | single-AZ, no replica (budget) |
| Backups | automatic, kept 1 day; no final snapshot on destroy |
| Database | `testdb` (created empty) |
| Admin user | `dbadmin`, password from `random_password` |

### Secrets in SSM Parameter Store
| Parameter | Type | Holds |
|---|---|---|
| `/tutorials/db/endpoint` | String | the RDS address |
| `/tutorials/db/master_password` | SecureString | `dbadmin` password |
| `/tutorials/db/app_password` | SecureString | `appuser` password |

Read them on the EC2:
```bash
DB_HOST=$(aws ssm get-parameter --name /tutorials/db/endpoint --query Parameter.Value --output text)
MASTER_PASS=$(aws ssm get-parameter --name /tutorials/db/master_password --with-decryption --query Parameter.Value --output text)
APP_PASS=$(aws ssm get-parameter --name /tutorials/db/app_password --with-decryption --query Parameter.Value --output text)
echo "${#MASTER_PASS} ${#APP_PASS}"   # both 24 = filled in
```

### Inside the database (from the EC2, as `dbadmin`)
```bash
cd ~/projects/devops-tutorials-client-app-backend
mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" testdb < db/init/01-schema.sql
mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" -e "
  CREATE USER IF NOT EXISTS 'appuser'@'%' IDENTIFIED BY '$APP_PASS';
  ALTER USER 'appuser'@'%' IDENTIFIED BY '$APP_PASS';
  GRANT SELECT, INSERT, UPDATE, DELETE ON testdb.* TO 'appuser'@'%';"
mariadb -h "$DB_HOST" -u appuser -p"$APP_PASS" testdb -e "SHOW TABLES;"   # tutorials
```

| User | Used for | Can do |
|---|---|---|
| `dbadmin` | admin work only (schema, users, restore test) | everything |
| `appuser` | the app and the backup script | read and change **data** in `testdb` only |

### How the app reaches RDS
`backend container (172.18.x)` → Docker NAT → `EC2 10.20.1.9` → VPC → `RDS:3306`. RDS sees the EC2's address, not the container's, which is why the error said `'appuser'@'10.20.1.9'`.

> **Analogy:** a clerk on floor 3 sends a letter to the archive. The letter leaves through the office building's front desk, so the archive sees the **building's** return address, not the floor's.

---

## 6. Common problems and fixes

| Problem | Cause | Fix |
|---|---|---|
| Docker not installed on first boot | a stray `'SCRIPT'` line at the top of `user_data.sh` (bad paste) | rewrite the file with `#!/bin/bash` on line 1, then `terraform apply -replace=aws_instance.app` |
| `permission denied ... docker.sock` | you logged in before user_data added you to the `docker` group | log out and back in; check `groups` |
| `additional privileges requested: --allow=fs.read=..` | new Compose always builds with Bake, and the build folders are outside the stack folder | build with plain `docker build`, then `docker compose up -d` |
| Compose paths wrong | the repos are cloned with their own names | use `../devops-tutorials-client-app-*` everywhere |
| `ER_ACCESS_DENIED_ERROR` for `appuser` | the password in RDS ≠ the password in `.env` (an empty variable) | `ALTER USER` with the SSM password, rewrite `.env`, `docker compose up -d --force-recreate backend` |
| `grep` showed only `INSERT INTO ... VALUES` | the new `mariadb-dump` puts each row on its own line | `grep -A5` |
| `DBInstanceNotFound` | the environment was destroyed | `terraform apply` rebuilds all 32 resources, then redo Step 7 |

**Lessons:** take every secret from **one source** (SSM) and check variables before using them (`${#VAR}`). A container reads `env_file` only when it's **created**. A backup isn't proven until you restore it.

---

## 7. Everyday commands (Mac)

```bash
cd ~/projects/tutorials-infra/infra

# pause (keeps everything; RDS restarts by itself after 7 days)
aws rds stop-db-instance --db-instance-identifier tutorials-db
aws ec2 stop-instances --instance-ids <i-...>

# resume (EC2 gets a new public IP)
aws rds start-db-instance --db-instance-identifier tutorials-db
aws ec2 start-instances --instance-ids <i-...>
terraform apply -refresh-only
terraform output ssh_command

# delete everything / rebuild everything
terraform destroy
terraform apply          # then redo Step 7
```

---

## 8. Budget shortcuts vs production

| Here | Production |
|---|---|
| 1 EC2, 1 AZ, nginx | 2+ servers in 2 AZs behind an ALB, or ECS |
| RDS single-AZ, 1-day backups | Multi-AZ, longer retention, alarms |
| SSH tunnel | domain + HTTPS (Route 53, ACM) |
| Step 7 by hand | images in ECR, deployed by a Jenkins pipeline |

**Possible next step:** automate Step 7 (user_data → ECR → pipeline).
