create database QLDOAN
go
use QLDOAN
go

CREATE TABLE users
(
    id INT IDENTITY PRIMARY KEY,
    username NVARCHAR(50) NOT NULL,
    password VARCHAR(128) NOT NULL,
    role NVARCHAR(20) NOT NULL,
    full_name NVARCHAR(100) NULL,
    email NVARCHAR(100) NULL,
    phone_number VARCHAR(20) NULL,
    address NVARCHAR(255) NULL,
    profile_pic NVARCHAR(500) NULL,
    date_of_birth DATE NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT UQ_users_username UNIQUE (username),
    CONSTRAINT UQ_users_email UNIQUE (email)
);

CREATE TABLE customers
(
    id INT IDENTITY PRIMARY KEY,
    user_id INT NOT NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT FK_customers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);



CREATE TABLE admins
(
    id INT IDENTITY PRIMARY KEY,
    user_id INT NOT NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT FK_admins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE employees
(
    id INT IDENTITY PRIMARY KEY,
    user_id INT NOT NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT FK_employees_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table for rooms available for rent
CREATE TABLE rooms
(
    id INT IDENTITY PRIMARY KEY,
    room_number NVARCHAR(50) NOT NULL,
    room_type NVARCHAR(50) NOT NULL, -- "phòng tự học" or "phòng lab"
    size_sqm DECIMAL(10, 2) NULL, -- e.g., size in square meters
    description NVARCHAR(MAX) NULL,
    rent_price DECIMAL(10, 2) NOT NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT UQ_rooms_room_number UNIQUE (room_number),
    CONSTRAINT CK_rooms_room_type CHECK (room_type IN (N'phòng tự học', N'phòng lab'))
);

-- Table to define all possible furniture items
CREATE TABLE furniture
(
    id INT IDENTITY PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    description NVARCHAR(255) NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT UQ_furniture_name UNIQUE (name)
);

-- Linking table to assign multiple furniture items to a room
CREATE TABLE room_furniture
(
    room_id INT NOT NULL,
    furniture_id INT NOT NULL,
    quantity INT DEFAULT 1 NOT NULL,
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    PRIMARY KEY (room_id, furniture_id),
    CONSTRAINT FK_room_furniture_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT FK_room_furniture_furniture FOREIGN KEY (furniture_id) REFERENCES furniture(id) ON DELETE CASCADE
);

-- Table for customer rental contracts
CREATE TABLE rental_contracts
(
    id INT IDENTITY PRIMARY KEY,
    customer_id INT NOT NULL,
    room_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_rent DECIMAL(12, 2) NOT NULL,
    status NVARCHAR(50) DEFAULT 'active' NOT NULL, -- e.g., 'active', 'completed', 'cancelled'
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT FK_rental_contracts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    CONSTRAINT FK_rental_contracts_room FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- Table for payments
CREATE TABLE payments
(
    id INT IDENTITY PRIMARY KEY,
    rental_contract_id INT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    payment_date DATETIME DEFAULT GETDATE() NOT NULL,
    payment_method NVARCHAR(50) NULL, -- e.g., 'Cash', 'Credit Card', 'Bank Transfer'
    status NVARCHAR(50) DEFAULT 'completed' NOT NULL, -- e.g., 'completed', 'pending', 'failed'
    created_at DATETIME DEFAULT GETDATE() NOT NULL,
    updated_at DATETIME DEFAULT GETDATE() NOT NULL,
    CONSTRAINT FK_payments_rental_contract FOREIGN KEY (rental_contract_id) REFERENCES rental_contracts(id) ON DELETE CASCADE
);


-- Disable foreign key constraints
ALTER TABLE payments NOCHECK CONSTRAINT ALL;
ALTER TABLE rental_contracts NOCHECK CONSTRAINT ALL;
ALTER TABLE room_furniture NOCHECK CONSTRAINT ALL;
ALTER TABLE furniture NOCHECK CONSTRAINT ALL;
ALTER TABLE rooms NOCHECK CONSTRAINT ALL;
ALTER TABLE employees NOCHECK CONSTRAINT ALL;
ALTER TABLE admins NOCHECK CONSTRAINT ALL;
ALTER TABLE customers NOCHECK CONSTRAINT ALL;
ALTER TABLE users NOCHECK CONSTRAINT ALL;

-- Delete data from child tables first
DELETE FROM payments;
DELETE FROM rental_contracts;
DELETE FROM room_furniture;
DELETE FROM furniture;
DELETE FROM rooms;
DELETE FROM employees;
DELETE FROM admins;
DELETE FROM customers;
DELETE FROM users;

-- Reset identity seeds
DBCC CHECKIDENT ('payments', RESEED, 0);
DBCC CHECKIDENT ('rental_contracts', RESEED, 0);
DBCC CHECKIDENT ('furniture', RESEED, 0);
DBCC CHECKIDENT ('rooms', RESEED, 0);
DBCC CHECKIDENT ('employees', RESEED, 0);
DBCC CHECKIDENT ('admins', RESEED, 0);
DBCC CHECKIDENT ('customers', RESEED, 0);
DBCC CHECKIDENT ('users', RESEED, 0);
-- Re-enable constraints
ALTER TABLE payments CHECK CONSTRAINT ALL;
ALTER TABLE rental_contracts CHECK CONSTRAINT ALL;
ALTER TABLE room_furniture CHECK CONSTRAINT ALL;
ALTER TABLE furniture CHECK CONSTRAINT ALL;
ALTER TABLE rooms CHECK CONSTRAINT ALL;
ALTER TABLE employees CHECK CONSTRAINT ALL;
ALTER TABLE admins CHECK CONSTRAINT ALL;
ALTER TABLE customers CHECK CONSTRAINT ALL;
ALTER TABLE users CHECK CONSTRAINT ALL;



-- Insert demo data

-- Insert users (passwords should be hashed in a real application)
INSERT INTO users (username, password, role, full_name, email, phone_number, address, date_of_birth) VALUES
('admin', '$2b$10$TPE79JXdRYc3c9EnKLLTPe4iSkP.SB3D79RMIIhxmh/tQkS7ezQ.C', 'admin', N'Quản Trị Viên', 'admin@example.com', '0123456789', N'123 Admin St, Admin City', '1990-01-01'),
('employee1', '$2b$10$TPE79JXdRYc3c9EnKLLTPe4iSkP.SB3D79RMIIhxmh/tQkS7ezQ.C', 'employee', N'Nhân Viên Một', 'employee1@example.com', '0987654321', N'456 Employee Ave, Work City', '1995-05-10'),
('customer1', '$2b$10$TPE79JXdRYc3c9EnKLLTPe4iSkP.SB3D79RMIIhxmh/tQkS7ezQ.C', 'customer', N'Khách Hàng A', 'customer1@example.com', '0112233445', N'789 Customer Rd, Client Town', '2000-02-20'),
('customer2', '$2b$10$TPE79JXdRYc3c9EnKLLTPe4iSkP.SB3D79RMIIhxmh/tQkS7ezQ.C', 'customer', N'Khách Hàng B', 'customer2@example.com', '0556677889', N'101 Guest Ln, Visitor Village', '2002-08-15');

-- Insert into role-specific tables
-- Assuming user IDs are 1 for admin, 2 for employee, 3 and 4 for customers
INSERT INTO admins (user_id) VALUES (1);
INSERT INTO employees (user_id) VALUES (2);
INSERT INTO customers (user_id) VALUES (3);
INSERT INTO customers (user_id) VALUES (4);

-- Insert rooms
INSERT INTO rooms (room_number, room_type, size_sqm, description, rent_price) VALUES
(N'P101', N'phòng tự học', 25.5, N'Phòng học nhóm nhỏ, có bảng trắng.', 50000.00),
(N'L201', N'phòng lab', 40.0, N'Phòng lab với 10 máy tính cấu hình cao.', 120000.00),
(N'P102', N'phòng tự học', 30.0, N'Phòng tự học lớn, có máy chiếu.', 75000.00);

-- Insert furniture
INSERT INTO furniture (name, description) VALUES
(N'Bàn học', N'Bàn gỗ cho 4 người'),
(N'Ghế', N'Ghế tựa văn phòng'),
(N'Bảng trắng', N'Bảng viết bút lông'),
(N'Máy chiếu', N'Máy chiếu Full HD');

-- Link furniture to rooms
-- Assuming room IDs are 1, 2, 3 and furniture IDs are 1, 2, 3, 4
-- Room P101 (ID 1)
INSERT INTO room_furniture (room_id, furniture_id, quantity) VALUES
(1, 1, 2), -- 2 Bàn học
(1, 2, 8), -- 8 Ghế
(1, 3, 1); -- 1 Bảng trắng

-- Room L201 (ID 2)
INSERT INTO room_furniture (room_id, furniture_id, quantity) VALUES
(2, 1, 10), -- 10 Bàn học (cho máy tính)
(2, 2, 10); -- 10 Ghế

-- Room P102 (ID 3)
INSERT INTO room_furniture (room_id, furniture_id, quantity) VALUES
(3, 4, 1); -- 1 Máy chiếu

-- Insert rental contracts
-- Assuming customer ID for 'Khách Hàng A' is 1, 'Khách Hàng B' is 2
-- Room P102 (ID 3), Room P101 (ID 1)

-- A completed contract from the past for Customer A
INSERT INTO rental_contracts (customer_id, room_id, start_date, end_date, total_rent, status) VALUES
(1, 3, '2024-04-01', '2024-04-30', 750000.00, 'completed');

-- An active, ongoing contract for Customer B
INSERT INTO rental_contracts (customer_id, room_id, start_date, end_date, total_rent, status) VALUES
(2, 1, GETDATE(), DATEADD(day, 30, GETDATE()), 50000.00 * 31, 'active');

-- Insert payments
-- Assuming the rental contract IDs created above are 1 and 2
INSERT INTO payments (rental_contract_id, amount, payment_date, payment_method, status) VALUES
(1, 750000.00, '2024-04-01T10:00:00', N'Credit Card', 'completed'),
(2, 50000.00 * 31, GETDATE(), N'Cash', 'completed');

