# Tutorials App on AWS with Terraform: Full Setup Tutorial

Build the Node + MariaDB **tutorials** app (React frontend, Express backend) on AWS, step by step. Terraform on your Mac creates the infrastructure, Docker Compose runs the app on an EC2, RDS holds the data, and a nightly job backs the database up to S3.

The setup is designed to be cheap: no NAT gateway, no load balancer, single-AZ RDS.

For a short overview of what was built, see [aws-terraform-summary.md](aws-terraform-summary.md).

**How to read this guide**
- 🖥️ **Mac** = run on your laptop (zsh) · ☁️ **EC2** = run on the server over SSH
- ✅ = what you should see if it worked
- `<account>` = your 12-digit AWS account number · `<EC2 IP>` = from `terraform output`
- Every step ends with `terraform plan` → `apply` → `git commit`

---

## Contents

| Step | What you build | Resources |
|---|---|---|
| 0 | Tools, state bucket, SSH key, project folder | by hand |
| 1 | Terraform settings: versions, backend, provider, variables | 0 |
| 2 | Network: VPC, subnets, IGW, route tables | 10 |
| 3 | Security groups | 5 |
| 4 | S3 backup bucket | 5 |
| 5 | RDS MariaDB + passwords in SSM | 7 |
| 6 | IAM role + EC2 + first-boot script | 5 |
| 7 | Deploy the app with Docker Compose | on the server |
| 8 | Nightly backup to S3 + restore test | on the server |
| — | Appendix: pause, destroy, rebuild, troubleshooting | |

**Total: 32 Terraform resources.**

---

## The final picture

```
Mac ── SSH tunnel (22) ──▶ IGW ──▶ EC2  (public subnet 10.20.1.0/24, AZ a)
                                    ├─ frontend     :8081
                                    ├─ lb (nginx)   :8080 ──▶ backend-1, backend-2
                                    └─ cron → backup-db.sh
                                          │ 3306                  │ AWS API (IAM role)
                                          ▼                       ▼
                    RDS MariaDB  (private subnets, AZ a + b)    SSM (secrets) · S3 (backups)

Terraform (Mac) ──▶ S3 state bucket (terraform.tfstate + lock)
```

**The analogy:** Terraform is the **architect**. The VPC is a **gated campus**: the public subnet is the zone by the **main gate** (IGW), and the private subnets are a back zone with no street. Security groups are **guards with guest lists**. The EC2 is the **office building**, nginx is the **receptionist**, and the backends are two **clerks**. RDS is a separate **archive building** run by AWS staff. SSM is the **key cabinet**, the IAM role is the building's **staff badge**, and S3 is the **off-site vault**.

---

# Step 0: Prepare (by hand)

> **Analogy:** before the architect can build, they need tools, a safe place for the record book, and your personal door key.

## 0.1 Install the tools

🖥️ **Mac**
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
brew install awscli
terraform -version
aws --version
```
✅ Terraform **1.10 or newer** (needed for `use_lockfile`), and AWS CLI v2.

## 0.2 Log in to AWS

```bash
aws configure
aws sts get-caller-identity
```

Give it your access key, your secret key, region `us-east-1` and output `json`.

✅ You see your account number and your IAM user.

💰 Set a **$10 budget alert** in the console (Billing → Budgets) before building anything.

## 0.3 Make the state bucket

Terraform keeps its memory (the **state file**) in S3. That bucket must exist **before** Terraform runs, so you make it by hand.

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=tutorials-tfstate-$ACCOUNT

aws s3api create-bucket --bucket $BUCKET --region us-east-1
aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $BUCKET --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
echo $BUCKET
```

| Part | What it does |
|---|---|
| `create-bucket` | makes the bucket (in us-east-1 you don't need a location setting) |
| `put-bucket-versioning` | keeps old copies of the state, so you can roll back a broken one |
| `put-public-access-block` | the bucket can never be made public |
| `put-bucket-encryption` | encrypts every file at rest |

✅ It prints `tutorials-tfstate-<account>`. Write the name down for Step 1.

## 0.4 Make your SSH key (outside Terraform)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tutorials-ec2 -C "tutorials-ec2"
```
```bash
ls ~/.ssh/tutorials-ec2*
```
✅ Two files: `tutorials-ec2` (private, **never share**) and `tutorials-ec2.pub` (public).

**Why not let Terraform make the key?** Anything Terraform creates is saved in the state file. A private key in state is a secret sitting in S3. So you make it yourself, and Terraform only uploads the **public** half.

## 0.5 Project folder and Git

```bash
mkdir -p ~/projects/tutorials-infra/infra
cd ~/projects/tutorials-infra
git init
```

Create `.gitignore`:

```gitignore
.terraform/
*.tfstate
*.tfstate.*
crash.log
*.tfplan
*.tfvars
*.pem
*.key
```

✅ `.terraform.lock.hcl` is **not** in the list. Commit it: it pins the provider versions.

```bash
git add .gitignore
git commit -m "Initial: gitignore"
```

---

# Step 1: Terraform settings

> **Analogy:** tell the architect which tools to use, where the record book lives, and which city to build in.

All files go in `~/projects/tutorials-infra/infra/`.

## `versions.tf`

```hcl
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket       = "tutorials-tfstate-<account>"   # your bucket from 0.3
    key          = "tutorials/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

| Part | What it does |
|---|---|
| `required_version` | refuses to run on an older Terraform |
| `~> 6.0` | any 6.x version of the AWS provider, never 7.0 |
| `random` | makes the database passwords (Step 5) |
| `backend "s3"` | keep the state in S3, not on your laptop |
| `key` | the file's path inside the bucket |
| `use_lockfile` | writes a `.tflock` file while you run, so two people can't change things at once |

## `providers.tf`

```hcl
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}
```

`default_tags` puts these two tags on **every** resource, which makes it easy to find and filter them later.

## `variables.tf`

```hcl
variable "project" {
  description = "Name prefix for all resources"
  type        = string
  default     = "tutorials"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "my_ip" {
  description = "Your public IP as a /32, e.g. 203.0.113.10/32"
  type        = string

  validation {
    condition     = can(cidrhost(var.my_ip, 0)) && endswith(var.my_ip, "/32")
    error_message = "my_ip must be a single IPv4 address ending in /32."
  }
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key on this computer"
  type        = string
  default     = "~/.ssh/tutorials-ec2.pub"
}
```

`my_ip` has **no default**, so you must give it. The `validation` blocks mistakes like `0.0.0.0/0`.

## `terraform.tfvars` (gitignored)

```bash
curl -s https://checkip.amazonaws.com
```
```hcl
my_ip = "<your IP>/32"
```

## Initialise

🖥️ **Mac**
```bash
cd ~/projects/tutorials-infra/infra
terraform init
terraform fmt
terraform validate
```
✅ `Successfully configured the backend "s3"!`, then `Terraform has been successfully initialized!`, then `Success! The configuration is valid.`

```bash
cd .. && git add . && git commit -m "Step 1: versions, backend, provider, variables" && cd infra
```

---

# Step 2: Network (10 resources)

> **Analogy:** fence the campus, mark one front zone by the main gate and two back zones, then put up signposts: "street → this way" in front, no sign at all in the back.

## `network.tf`

```hcl
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags = { Name = "${var.project}-public" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.20.11.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
  tags = { Name = "${var.project}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.20.12.0/24"
  availability_zone = data.aws_availability_zones.available.names[1]
  tags = { Name = "${var.project}-private-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-private-rt" }
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private.id
}
```

| Piece | What it does |
|---|---|
| `data "aws_availability_zones"` | **reads** the AZ names (`us-east-1a`, ...). It creates nothing |
| VPC `10.20.0.0/16` | your private network: 65,536 addresses |
| Internet Gateway | the door between the VPC and the internet |
| public subnet `10.20.1.0/24` | the EC2 lives here; `map_public_ip_on_launch` gives it a public IP |
| 2 private subnets in **2 AZs** | RDS needs a subnet group that spans 2 AZs, even when it runs in only one |
| public route table | `0.0.0.0/0 → IGW`: "anything outside goes out the gate" |
| private route table | **no routes**: the back zone can't reach the internet. No NAT gateway, which saves about $32/month |

```bash
terraform plan
```
✅ `Plan: 10 to add, 0 to change, 0 to destroy.`

```bash
terraform apply
```
Type `yes`.

✅ `Apply complete! Resources: 10 added`

```bash
cd .. && git add . && git commit -m "Step 2: network" && cd infra
```

---

# Step 3: Security groups (5 resources)

> **Analogy:** two guards. The office guard lets in only **you**, at door 22. The archive guard lets in only people **from the office building**, at door 3306.

## `security.tf`

```hcl
resource "aws_security_group" "app" {
  name        = "${var.project}-app-sg"
  description = "App server: SSH from my IP"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project}-app-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "app_ssh" {
  security_group_id = aws_security_group.app.id
  description       = "SSH from my IP only"
  cidr_ipv4         = var.my_ip
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_egress_rule" "app_all_out" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound (apt, Docker Hub, GitHub, AWS APIs)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db-sg"
  description = "RDS: MariaDB from the app server only"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project}-db-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "MariaDB from app SG"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
}
```

| Rule | Meaning |
|---|---|
| `app_ssh` | port 22, only from your `/32` |
| `app_all_out` | the server may go out anywhere (`-1` = all protocols) |
| `db_from_app` | port 3306, only from servers **wearing the app SG**, not from an IP range |
| no egress rule on `db` | RDS never needs to start a connection out |

Ports 8080 and 8081 are **not** opened. You reach them through an SSH tunnel (Step 7), so the app is never on the public internet.

Each rule is its own resource (`aws_vpc_security_group_*_rule`) rather than an inline block, which is the current AWS provider recommendation: changing one rule doesn't rewrite the others.

```bash
terraform plan     # ✅ 5 to add
terraform apply
cd .. && git add . && git commit -m "Step 3: security groups" && cd infra
```

---

# Step 4: S3 backup bucket (5 resources)

> **Analogy:** rent a locked vault off-site. Nobody can make it public, everything inside is encrypted, old copies are kept, and anything older than 30 days is shredded.

## `storage.tf`

```hcl
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "backups" {
  bucket        = "${var.project}-backups-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = { Name = "${var.project}-backups" }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket     = aws_s3_bucket.backups.id
  depends_on = [aws_s3_bucket_versioning.backups]

  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
```

| Piece | What it does |
|---|---|
| `aws_caller_identity` | reads your account number, so the bucket name is unique worldwide |
| `force_destroy = true` | `terraform destroy` may delete the bucket **with** its files. Fine for practice; turn it off in production |
| public access block | 4 switches that make sure nothing can ever be public |
| encryption | every file is encrypted at rest |
| versioning | an overwritten or deleted file can be recovered |
| lifecycle | delete backups after 30 days, old versions after 7, half-finished uploads after 1 |
| `filter {}` | "applies to every file" (the provider needs it written out) |

```bash
terraform plan     # ✅ 5 to add
terraform apply
cd .. && git add . && git commit -m "Step 4: backup bucket" && cd infra
```

---

# Step 5: RDS MariaDB + SSM (7 resources)

> **Analogy:** build the archive in the back zone, staffed by AWS. Put its address and keys in a locked cabinet (SSM) so nobody has to write them down.

## `database.tf`

```hcl
resource "random_password" "db_master" {
  length  = 24
  special = false
}

resource "random_password" "db_app" {
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db-subnets"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  tags       = { Name = "${var.project}-db-subnets" }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "mariadb"
  engine_version = "11.4"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "testdb"
  username = "dbadmin"
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true

  tags = { Name = "${var.project}-db" }
}

resource "aws_ssm_parameter" "db_endpoint" {
  name  = "/${var.project}/db/endpoint"
  type  = "String"
  value = aws_db_instance.main.address
}

resource "aws_ssm_parameter" "db_master_password" {
  name  = "/${var.project}/db/master_password"
  type  = "SecureString"
  value = random_password.db_master.result
}

resource "aws_ssm_parameter" "db_app_password" {
  name  = "/${var.project}/db/app_password"
  type  = "SecureString"
  value = random_password.db_app.result
}
```

| Piece | What it does |
|---|---|
| `random_password` × 2 | makes the admin and app passwords. `special = false` avoids quoting problems in shells and `.env` |
| `aws_db_subnet_group` | the two private subnets RDS may use |
| `db.t4g.micro`, 20 GB gp3 | the smallest and cheapest setup (≈ $0.02/hour) |
| `db_name = "testdb"` | RDS creates this empty database for you |
| `publicly_accessible = false` | no public IP, ever |
| `multi_az = false` | one copy in one AZ, to save money (production: `true`) |
| `backup_retention_period = 1` | AWS keeps 1 day of automatic backups |
| `skip_final_snapshot`, `deletion_protection = false` | lets `destroy` delete it cleanly (practice only) |
| `aws_db_instance.main.address` | the DB's hostname, saved to SSM |
| `SecureString` | stored encrypted with the AWS-managed `aws/ssm` key |

⚠️ The passwords are also in the **state file**. That's why the state bucket is private, encrypted and versioned.

```bash
terraform plan     # ✅ 7 to add
terraform apply    # ⏳ RDS takes about 5–10 minutes
```

Check from the Mac (RDS itself is private, but SSM is reachable):

```bash
aws ssm get-parameter --name /tutorials/db/endpoint --query Parameter.Value --output text
```
✅ `tutorials-db.xxxx.us-east-1.rds.amazonaws.com`

```bash
cd .. && git add . && git commit -m "Step 5: RDS and SSM" && cd infra
```

---

# Step 6: IAM role + EC2 (5 resources)

> **Analogy:** put up the office building, give it a staff badge (IAM role), fit your lock on the side door (key pair), and leave a moving-in checklist (user_data) that runs the first time the lights come on.

## `user_data.sh`

Create it with `nano user_data.sh`, **not** a heredoc paste: a stray first line breaks it (see Troubleshooting). Line 1 **must** be `#!/bin/bash`.

```bash
#!/bin/bash
# Runs ONCE, as root, the first time the EC2 boots.
set -euxo pipefail

# 2 GB swap so builds don't run out of memory on a t3.micro
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# basic tools (wait up to 10 min if apt is busy with boot-time updates)
apt-get -o DPkg::Lock::Timeout=600 update
apt-get -o DPkg::Lock::Timeout=600 install -y ca-certificates curl git jq mariadb-client

# Docker from Docker's own repository
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get -o DPkg::Lock::Timeout=600 update
apt-get -o DPkg::Lock::Timeout=600 install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu

# AWS CLI (uses the IAM role, no keys)
snap install aws-cli --classic
echo 'export AWS_DEFAULT_REGION=us-east-1' > /etc/profile.d/aws-region.sh

echo "user_data finished" > /var/tmp/user-data-done
```

## `compute.tf`

```hcl
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_key_pair" "main" {
  key_name   = "${var.project}-key"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.project}-app-role"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "ReadOwnParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/*"]
  }

  statement {
    sid       = "ListBackupBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]
  }

  statement {
    sid       = "ReadWriteBackups"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${var.project}-app-policy"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.project}-app-profile"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = aws_key_pair.main.key_name
  iam_instance_profile   = aws_iam_instance_profile.app.name
  user_data              = file("${path.module}/user_data.sh")

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens = "required"
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = "${var.project}-app" }
}
```

| Piece | What it does |
|---|---|
| `ubuntu_ami` (data) | reads the newest Ubuntu 24.04 image ID from Canonical's public SSM parameter |
| `aws_key_pair` | uploads only your **public** key. `pathexpand` turns `~` into your home folder |
| `assume_ec2` | "EC2 servers may wear this role" |
| `aws_iam_role` + policy | the badge: read **only** `/tutorials/*` in SSM, use **only** the backup bucket |
| instance profile | the clip that attaches the role to an EC2 |
| `user_data = file(...)` | runs your script once at first boot |
| `metadata_options http_tokens = "required"` | IMDSv2: blocks a common way of stealing role credentials |
| `ignore_changes = [ami]` | a newer Ubuntu image won't make Terraform replace your server |

## `outputs.tf`

```hcl
output "vpc_id"             { value = aws_vpc.main.id }
output "public_subnet_id"   { value = aws_subnet.public.id }
output "private_subnet_ids" { value = [aws_subnet.private_a.id, aws_subnet.private_b.id] }
output "backup_bucket"      { value = aws_s3_bucket.backups.bucket }
output "db_endpoint"        { value = aws_db_instance.main.address }
output "ec2_public_ip"      { value = aws_instance.app.public_ip }
output "ssh_command"        { value = "ssh -i ~/.ssh/tutorials-ec2 ubuntu@${aws_instance.app.public_ip}" }
```

(`terraform fmt` will spread these over several lines. That's fine.)

## Apply and check

🖥️ **Mac**
```bash
terraform plan     # ✅ 5 to add
terraform apply
terraform output
```

Wait **about 3 minutes** for the first boot, then:

```bash
$(terraform output -raw ssh_command)
```

☁️ **EC2**
```bash
cloud-init status --wait
cat /var/tmp/user-data-done
groups
docker version
docker compose version
free -h
aws sts get-caller-identity
```

✅ **You should see:**
- `status: done`, then `user_data finished`
- `groups` includes `docker`. If it doesn't, run `exit` and SSH in again
- Docker and Compose versions, and 2 GB of swap
- an ARN ending in `assumed-role/tutorials-app-role/...`

**Test RDS and least privilege:**
```bash
DB_HOST=$(aws ssm get-parameter --name /tutorials/db/endpoint --query Parameter.Value --output text)
DB_PASS=$(aws ssm get-parameter --name /tutorials/db/master_password --with-decryption --query Parameter.Value --output text)
mariadb -h "$DB_HOST" -u dbadmin -p"$DB_PASS" -e "SELECT VERSION(); SHOW DATABASES;"
aws s3 ls
```

✅ You get a MariaDB `11.4.x` version and `testdb` in the database list. `aws s3 ls` says **AccessDenied**: the badge opens only its own bucket.

```bash
cd ~/projects/tutorials-infra && git add . && git commit -m "Step 6: IAM role, EC2, user_data"
```

🎉 **The infrastructure is done.**

---

# Step 7: Deploy the app (on the EC2)

> **Analogy:** the building is empty, so you move in. Bring the furniture (clone the code). Use the badge to open the key cabinet (SSM). Set up shelves in the archive and give the clerks a limited pass (schema + `appuser`). Pin the archive's address and pass in the clerks' office (`.env`). Then open the floors: the receptionist and the two clerks (Compose).

Run everything in **one** terminal; the variables from 7.2 are used later.

## 7.1 Clone the code

If the repos are private, give the server its own GitHub key first:

☁️ **EC2**
```bash
ssh-keygen -t ed25519 -C "tutorials-aws-ec2" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add the key on GitHub (**Settings → SSH and GPG keys**), then:

```bash
ssh -T git@github.com
mkdir -p ~/projects && cd ~/projects
git clone git@github.com:<your-github-user>/devops-tutorials-client-app-backend.git
git clone git@github.com:<your-github-user>/devops-tutorials-client-app-ui.git
ls
```

✅ `Hi <your-github-user>!`, then both folders are listed.

Check that the backend reads its settings from the environment:

```bash
cat devops-tutorials-client-app-backend/app/config/db.config.js
```

✅ It should look like this:

```js
module.exports = {
  HOST: process.env.DB_HOST || "localhost",
  READ_HOST: process.env.DB_READ_HOST || process.env.DB_HOST || "localhost",
  USER: process.env.DB_USER || "appuser",
  PASSWORD: process.env.DB_PASSWORD,
  DB: process.env.DB_NAME || "testdb"
};
```

There's no replica here, so `DB_READ_HOST` stays unset and reads use `DB_HOST`.

## 7.2 Read the values from SSM

```bash
DB_HOST=$(aws ssm get-parameter --name /tutorials/db/endpoint --query Parameter.Value --output text)
MASTER_PASS=$(aws ssm get-parameter --name /tutorials/db/master_password --with-decryption --query Parameter.Value --output text)
APP_PASS=$(aws ssm get-parameter --name /tutorials/db/app_password --with-decryption --query Parameter.Value --output text)
echo "host=$DB_HOST  master=${#MASTER_PASS}  app=${#APP_PASS}"
```

✅ The RDS address, `master=24` and `app=24`. **Stop if either is 0.** An empty password leads to an `Access denied` error later.

| Part | What it does |
|---|---|
| `--with-decryption` | decrypts the SecureString (the IAM role allows it) |
| `${#VAR}` | the **length** of a variable: proves it's filled without printing the secret |

## 7.3 Table + app user in RDS

```bash
cd ~/projects/devops-tutorials-client-app-backend
mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" testdb < db/init/01-schema.sql

mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" -e "
  CREATE USER IF NOT EXISTS 'appuser'@'%' IDENTIFIED BY '$APP_PASS';
  ALTER USER 'appuser'@'%' IDENTIFIED BY '$APP_PASS';
  GRANT SELECT, INSERT, UPDATE, DELETE ON testdb.* TO 'appuser'@'%';"

mariadb -h "$DB_HOST" -u appuser -p"$APP_PASS" testdb -e "SHOW TABLES;"
```

✅ The last command shows `tutorials`.

| Part | What it does |
|---|---|
| `< db/init/01-schema.sql` | runs the SQL file that creates the `tutorials` table |
| `CREATE USER IF NOT EXISTS` | makes the app's login if it's missing |
| `ALTER USER ... IDENTIFIED BY` | forces the password to match SSM, even if the user already existed |
| `'%'` | from any host. The **db security group** already limits it to the app server |
| `GRANT SELECT, INSERT, UPDATE, DELETE` | data only: no dropping tables, no creating users |

If the repo has no `01-schema.sql`, create the table directly:

```sql
CREATE TABLE IF NOT EXISTS tutorials (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description VARCHAR(255),
  published BOOLEAN DEFAULT false
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

| User | Used by | Can do |
|---|---|---|
| `dbadmin` | you, for admin work | everything |
| `appuser` | the app + the backup script | read and change data in `testdb` |

## 7.4 The backend's `.env`

```bash
cat > .env <<EOF
DB_HOST=$DB_HOST
DB_USER=appuser
DB_PASSWORD=$APP_PASS
DB_NAME=testdb
EOF
chmod 600 .env
sed 's/^DB_PASSWORD=.*/DB_PASSWORD=****/' .env
```

✅ All 4 lines are filled in, with the password shown as `****`.

| Part | What it does |
|---|---|
| `<<EOF` (no quotes) | the shell fills in `$DB_HOST` and `$APP_PASS` while writing |
| `chmod 600` | only you can read it |
| `sed 's/.../****/'` | shows the file with the password hidden |

This file is only on the server and is gitignored in the repo. You can rebuild it from SSM any time.

## 7.5 Compose files

```bash
mkdir -p ~/projects/tutorials-stack && cd ~/projects/tutorials-stack
nano docker-compose.yml
```

```yaml
name: tutorials

services:
  backend:
    build: ../devops-tutorials-client-app-backend
    image: tutorials-backend:aws
    env_file: ../devops-tutorials-client-app-backend/.env
    networks: [web-net]
    deploy:
      replicas: 2
    restart: unless-stopped

  lb:
    image: nginx:1.28-alpine
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks: [web-net]
    depends_on: [backend]
    restart: unless-stopped

  frontend:
    build: ../devops-tutorials-client-app-ui
    image: tutorials-client:aws
    ports:
      - "8081:8081"
    networks: [web-net]
    depends_on: [lb]
    restart: unless-stopped

networks:
  web-net:
```

| Part | What it does |
|---|---|
| `name: tutorials` | the project name: containers are called `tutorials-backend-1`, `tutorials-backend-2`, ... |
| `build` + `image` | where the code is, and the name of the image built from it |
| `env_file` | gives the backend the 4 `DB_*` values from 7.4. Read only when the container is **created** |
| `replicas: 2` | two backend containers from one service: the two clerks |
| no `ports` on `backend` | the backends are reachable only inside `web-net`, through nginx |
| `8080:80` | door 8080 on the EC2 → nginx on port 80 |
| `8081:8081` | door 8081 on the EC2 → the Vite dev server |
| `depends_on` | start order: backends, then nginx, then the frontend |

```bash
nano nginx.conf
```

```nginx
upstream backends {
    server backend:8080;
}

server {
    listen 80;

    location / {
        proxy_pass http://backends;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        add_header X-Served-By $upstream_addr always;
    }
}
```

| Part | What it does |
|---|---|
| `server backend:8080` | Docker's DNS answers `backend` with **both** replica IPs, so nginx takes turns between them |
| `proxy_pass` | sends every request to one of the backends |
| `X-Served-By` | adds a response header with the backend's IP, so you can see which clerk answered |

The browser calls the API at `http://localhost:8080/api` (the frontend's default), and the backend's CORS only allows `http://localhost:8081`. The SSH tunnel in 7.7 keeps both of those addresses working from the Mac.

## 7.6 Build and start

New Compose versions build through **Bake**, which asks for extra file permissions (`--allow=fs.read=..`) because the code folders are outside the stack folder. Build with plain `docker build` instead:

```bash
docker build -t tutorials-backend:aws ../devops-tutorials-client-app-backend
docker build -t tutorials-client:aws ../devops-tutorials-client-app-ui
docker compose up -d
docker compose ps
```

✅ Four containers are `Up`: `tutorials-backend-1`, `tutorials-backend-2`, `tutorials-lb-1`, `tutorials-frontend-1`.

```bash
docker compose logs backend | tail
```

✅ `Server is running on port 8080.` twice, and no `ER_ACCESS_DENIED_ERROR`.

## 7.7 Test it

☁️ **EC2**
```bash
curl -s -X POST http://localhost:8080/api/tutorials \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello from AWS","description":"first row in RDS"}'

curl -s http://localhost:8080/api/tutorials

for i in 1 2 3 4; do curl -s -o /dev/null -D - http://localhost:8080/api/tutorials | grep -i x-served-by; done
```

✅ The POST returns the new row with an `id`, the GET lists it, and `X-Served-By` shows **two different** IPs.

Check that the row really is in RDS:

```bash
mariadb -h "$DB_HOST" -u appuser -p"$APP_PASS" testdb -e "SELECT * FROM tutorials;"
```

🖥️ **Mac** (a new terminal, keep it open)
```bash
ssh -i ~/.ssh/tutorials-ec2 -N -L 8081:localhost:8081 -L 8080:localhost:8080 ubuntu@<EC2 IP>
```

| Part | What it does |
|---|---|
| `-N` | no shell, just the tunnel |
| `-L 8081:localhost:8081` | `localhost:8081` on the Mac → port 8081 on the EC2 (the frontend) |
| `-L 8080:localhost:8080` | `localhost:8080` on the Mac → port 8080 on the EC2 (nginx, for the API calls) |

Open `http://localhost:8081` in the browser.

✅ The tutorials list shows the row you made with `curl`. Add, edit and delete work.

🎉 **The app is live**, and nothing but port 22 is open to the internet.

---

# Step 8: Nightly backup to S3 + restore test (on the EC2)

> **Analogy:** hire a night watchman (cron) who wakes a clerk at 02:00 to photocopy the archive and carry the copy to the off-site vault (S3). Then hold a fire drill (restore test).

## 8.1 The backup script

☁️ **EC2**
```bash
mkdir -p ~/bin
nano ~/bin/backup-db.sh
```

```bash
#!/bin/bash
# Dump testdb from RDS, gzip it and upload it to the backup bucket.
set -euo pipefail

# cron starts with almost no PATH, and the AWS CLI lives in /snap/bin
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
export AWS_DEFAULT_REGION=us-east-1

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=tutorials-backups-$ACCOUNT

DB_HOST=$(aws ssm get-parameter --name /tutorials/db/endpoint --query Parameter.Value --output text)
DB_PASS=$(aws ssm get-parameter --name /tutorials/db/app_password --with-decryption --query Parameter.Value --output text)

STAMP=$(date -u +%Y-%m-%d_%H%M)
KEY=mariadb/testdb_$STAMP.sql.gz
TMP=$(mktemp /tmp/testdb_XXXXXX.sql.gz)
trap 'rm -f "$TMP"' EXIT

mariadb-dump -h "$DB_HOST" -u appuser -p"$DB_PASS" \
  --single-transaction --no-tablespaces testdb | gzip > "$TMP"

aws s3 cp "$TMP" "s3://$BUCKET/$KEY" --only-show-errors

echo "$(date -u +%FT%TZ) backup ok: s3://$BUCKET/$KEY ($(stat -c %s "$TMP") bytes)"
```

| Part | What it does |
|---|---|
| `set -euo pipefail` | stop on any error, including a failed `mariadb-dump` inside the pipe |
| `PATH` + region | cron gives the script almost nothing, so set both by hand |
| `sts get-caller-identity` | finds the account number, so the bucket name isn't hard-coded |
| `ssm get-parameter` | reads the address and the **app** password with the IAM role: no keys on disk |
| `--single-transaction` | a consistent copy without locking the tables |
| `--no-tablespaces` | skips tablespace info, which needs the `PROCESS` privilege that `appuser` doesn't have |
| `trap ... EXIT` | deletes the temp file even if the script fails |

```bash
chmod +x ~/bin/backup-db.sh
~/bin/backup-db.sh
```

✅ One line: `... backup ok: s3://tutorials-backups-<account>/mariadb/testdb_YYYY-MM-DD_HHMM.sql.gz (... bytes)`

## 8.2 Check the backup

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3 ls s3://tutorials-backups-$ACCOUNT/mariadb/
LATEST=$(aws s3 ls s3://tutorials-backups-$ACCOUNT/mariadb/ | sort | tail -1 | awk '{print $4}')
aws s3 cp s3://tutorials-backups-$ACCOUNT/mariadb/$LATEST - | gunzip | grep -A5 "INSERT INTO"
```

✅ The file is listed, and you see your rows under `INSERT INTO \`tutorials\` VALUES`. The new `mariadb-dump` puts each row on its own line, which is why you need `-A5`.

## 8.3 Schedule it with cron

```bash
crontab -e
```

Add this line:

```
0 20 * * * /home/ubuntu/bin/backup-db.sh >> /home/ubuntu/backup.log 2>&1
```

| Part | What it does |
|---|---|
| `0 20 * * *` | every day at 20:00 **UTC** (the EC2's clock) = 02:00 at UTC+6. Change the hour for your time zone |
| `>> ~/backup.log 2>&1` | keeps the output and any errors in one log file |

```bash
crontab -l
```

✅ The line is listed. The next morning, `tail ~/backup.log` shows a `backup ok` line.

## 8.4 Restore test (the fire drill)

A backup isn't proven until you restore it. Restore into a **separate** database, compare, then delete it.

```bash
mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" -e "CREATE DATABASE testdb_restore;"

aws s3 cp s3://tutorials-backups-$ACCOUNT/mariadb/$LATEST - | gunzip \
  | mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" testdb_restore

mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" -e "
  SELECT COUNT(*) FROM testdb.tutorials;
  SELECT COUNT(*) FROM testdb_restore.tutorials;"

mariadb -h "$DB_HOST" -u dbadmin -p"$MASTER_PASS" -e "DROP DATABASE testdb_restore;"
```

✅ Both counts are the same (if nobody added rows after the backup).

`dbadmin` is used here because `appuser` can't create or drop databases.

🎉 **Done:** infrastructure in code, app running, nightly backups that are proven to restore.

---

# Appendix

## A. Pause and resume (save money without deleting)

🖥️ **Mac**
```bash
cd ~/projects/tutorials-infra/infra

# pause
aws rds stop-db-instance --db-instance-identifier tutorials-db
aws ec2 stop-instances --instance-ids <i-...>

# resume
aws rds start-db-instance --db-instance-identifier tutorials-db
aws ec2 start-instances --instance-ids <i-...>
terraform apply -refresh-only
terraform output ssh_command
```

- A stopped RDS **starts again by itself after 7 days**.
- A stopped EC2 still pays for its 20 GB disk, and gets a **new public IP** when it starts. `-refresh-only` updates the state so `terraform output` shows the new IP.
- The containers come back on their own (`restart: unless-stopped`).

## B. Destroy everything

```bash
terraform plan -destroy
terraform destroy
```

✅ `Destroy complete! Resources: 32 destroyed.`

What's gone: the VPC, the EC2 (and everything on it: code, `.env`, cron), RDS **with its data**, the backup bucket **with its backups** (`force_destroy = true`), the SSM parameters and the IAM role.

What stays: the **state bucket** (made by hand in 0.3), your SSH key, and the code in Git.

## C. Rebuild from scratch

```bash
terraform apply
```

✅ `Apply complete! Resources: 32 added.` (≈ 10 minutes, mostly RDS)

The new RDS is **empty** and gets **new passwords**. Then redo Step 7 (clone, schema, `appuser`, `.env`, Compose) and Step 8 (script and cron).

## D. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Docker not installed on first boot | a stray `'SCRIPT'` line at the top of `user_data.sh` (bad paste) | rewrite the file with `#!/bin/bash` on line 1, then `terraform apply -replace=aws_instance.app` |
| `permission denied ... docker.sock` | you logged in before user_data added you to the `docker` group | log out and back in; check `groups` |
| `additional privileges requested: --allow=fs.read=..` | new Compose always builds with Bake, and the build folders are outside the stack folder | build with plain `docker build`, then `docker compose up -d` |
| Compose can't find the code | the repos are cloned with their own names | use `../devops-tutorials-client-app-*` everywhere |
| `ER_ACCESS_DENIED_ERROR` for `appuser` | the password in RDS ≠ the password in `.env` (an empty variable) | check `${#APP_PASS}`, `ALTER USER` with the SSM password, rewrite `.env`, then `docker compose up -d --force-recreate backend` |
| Access denied for `'appuser'@'10.20.1.9'` | RDS sees the **EC2's** address, not the container's (Docker NAT) | that's normal; the cause is the password, see the row above |
| `grep` shows only `INSERT INTO ... VALUES` | the new `mariadb-dump` puts each row on its own line | `grep -A5` |
| `DBInstanceNotFound` | the environment was destroyed | `terraform apply`, then Step 7 and Step 8 again |
| SSH times out | your home IP changed | update `my_ip` in `terraform.tfvars`, then `terraform apply` |
| Browser shows a CORS error | the page isn't opened as `http://localhost:8081` | open it through the tunnel at exactly that address |

**Lessons:** take every secret from **one source** (SSM) and check variables before using them (`${#VAR}`). A container reads `env_file` only when it's **created**. A backup isn't proven until you restore it.

## E. Budget shortcuts vs production

| Here | Production |
|---|---|
| 1 EC2, 1 AZ, nginx | 2+ servers in 2 AZs behind an ALB, or ECS |
| RDS single-AZ, 1-day backups | Multi-AZ, longer retention, alarms |
| SSH tunnel | domain + HTTPS (Route 53, ACM) |
| Step 7 by hand | images in ECR, deployed by a Jenkins pipeline |
| `force_destroy`, `skip_final_snapshot` | off, so data can't be deleted by accident |

**Possible next step:** automate Step 7 (user_data → ECR → pipeline).
