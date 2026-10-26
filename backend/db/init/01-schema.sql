-- Runs automatically the FIRST time the MariaDB container starts
-- with an empty data volume (see /docker-entrypoint-initdb.d).
CREATE TABLE IF NOT EXISTS tutorials (
  id int(11) NOT NULL PRIMARY KEY AUTO_INCREMENT,
  title varchar(255) NOT NULL,
  description varchar(255),
  published BOOLEAN DEFAULT false
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
