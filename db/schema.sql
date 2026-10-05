-- Sports Equipment Locker : schema (Azure SQL / SQL Server)
-- Run once in Azure Portal -> SQL database -> Query editor

IF OBJECT_ID('dbo.sports', 'U') IS NULL
CREATE TABLE dbo.sports (
  id    INT IDENTITY(1,1) PRIMARY KEY,
  name  NVARCHAR(60) NOT NULL UNIQUE
);

IF OBJECT_ID('dbo.equipment', 'U') IS NULL
CREATE TABLE dbo.equipment (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  sport_id   INT NOT NULL REFERENCES dbo.sports(id),
  name       NVARCHAR(100) NOT NULL,
  total_qty  INT NOT NULL CONSTRAINT ck_equipment_total CHECK (total_qty >= 0),
  CONSTRAINT uq_equipment_sport_name UNIQUE (sport_id, name)
);

IF OBJECT_ID('dbo.loans', 'U') IS NULL
CREATE TABLE dbo.loans (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  equipment_id   INT NOT NULL REFERENCES dbo.equipment(id),
  borrower_name  NVARCHAR(100) NOT NULL,
  borrower_code  NVARCHAR(20)  NOT NULL,          -- student / staff id
  qty            INT NOT NULL CONSTRAINT ck_loans_qty CHECK (qty > 0),
  borrowed_at    DATETIME2 NOT NULL CONSTRAINT df_loans_borrowed DEFAULT SYSUTCDATETIME(),
  due_date       DATE NOT NULL,
  returned_at    DATETIME2 NULL                   -- NULL = still borrowed
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_loans_equipment')
  CREATE INDEX ix_loans_equipment ON dbo.loans(equipment_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_loans_borrower')
  CREATE INDEX ix_loans_borrower ON dbo.loans(borrower_code);
