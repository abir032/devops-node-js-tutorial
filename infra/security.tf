
resource "aws_security_group" "app" {
  name        = "${var.project}-app"
  description = "App server: SSH from my IP, all outbound"
  vpc_id      = aws_vpc.main.id
  tags = {
    Name = "${var.project}-app"
  }
}


resource "aws_vpc_security_group_ingress_rule" "app_ssh" {
  security_group_id = aws_security_group.app.id
  description       = "SSH from my app"
  cidr_ipv4         = var.my_ip
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}


resource "aws_vpc_security_group_egress_rule" "app_all_out" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound: Docker images, S3, updates"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1" // All protocols and port
}


# Guard for rds 

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "Database: MariaDB from the app server only"
  vpc_id      = aws_vpc.main.id
  tags = {
    "Name" = "${var.project}-db"
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "MariaDB from the app security group"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306

}