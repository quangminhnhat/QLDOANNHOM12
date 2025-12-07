CREATE DATABASE DOANCS;
GO
USE DOANCS;
GO

CREATE TABLE users (
    id INT PRIMARY KEY IDENTITY,
    username NVARCHAR(50),
    password NVARCHAR(255),
    role NVARCHAR(20),
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_username UNIQUE (username)
);

CREATE TABLE students (
    id INT PRIMARY KEY IDENTITY,
    user_id INT,
    full_name NVARCHAR(100),
    email NVARCHAR(100),
    phone_number NVARCHAR(20),
    address NVARCHAR(255),
    date_of_birth DATE,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE teachers (
    id INT PRIMARY KEY IDENTITY,
    user_id INT,
    full_name NVARCHAR(100),
    email NVARCHAR(100),
    phone_number NVARCHAR(20),
    address NVARCHAR(255),
    date_of_birth DATE,
    salary DECIMAL(18, 2),
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE admins (
    id INT PRIMARY KEY IDENTITY,
    user_id INT NOT NULL,
    full_name NVARCHAR(100),
    email NVARCHAR(100),
    phone_number NVARCHAR(20),
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE notifications (
    id INT PRIMARY KEY IDENTITY,
    user_id INT,
    message NVARCHAR(255),
    sent_at DATETIME DEFAULT GETDATE(),
    sender_id INT,
     [read] BIT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);
CREATE TABLE courses (
    id INT PRIMARY KEY IDENTITY,
    course_name NVARCHAR(100),
    description NVARCHAR(MAX),
    start_date DATE,
    end_date DATE,
    tuition_fee int,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    image_path NVARCHAR(500),
    link NVARCHAR(255) 
);


CREATE TABLE materials (
    id INT PRIMARY KEY IDENTITY,
    course_id INT NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    uploaded_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE classes (
    id INT PRIMARY KEY IDENTITY,
    class_name NVARCHAR(100),
    course_id INT,
    teacher_id INT,
    start_time TIME,
    end_time TIME,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    weekly_schedule varchar(100),  -- Stores days like "1,3,5" for Mon,Wed,Fri
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

-- Drop existing table if it exists
DROP TABLE IF EXISTS schedules;

-- Recreate schedules table with modified constraints
CREATE TABLE schedules (
    id INT PRIMARY KEY IDENTITY,
    class_id INT,
    course_id INT,
    day_of_week NVARCHAR(20), 
    schedule_date DATE,        
    start_time TIME,
    end_time TIME,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE NO ACTION,
    CONSTRAINT CHK_schedule_times CHECK (end_time > start_time)
);

CREATE TABLE enrollments (
    id INT PRIMARY KEY IDENTITY,
    student_id INT,
    class_id INT,
    enrollment_date DATE,
    payment_status BIT DEFAULT 0,
    payment_date DATETIME,
    updated_at DATETIME DEFAULT GETDATE(),
    created_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);





-- Indexes for better performance
CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_teachers_user_id ON teachers(user_id);
CREATE INDEX idx_admins_user_id ON admins(user_id);
CREATE INDEX idx_materials_course_id ON materials(course_id);
CREATE INDEX idx_classes_course_id ON classes(course_id);
CREATE INDEX idx_classes_teacher_id ON classes(teacher_id);
CREATE INDEX idx_schedules_class_id ON schedules(class_id);
CREATE INDEX idx_schedules_course_id ON schedules(course_id);
CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX idx_enrollments_class_id ON enrollments(class_id);





--do above first Triggers for updated_at
CREATE TRIGGER trg_students_update ON students
AFTER UPDATE AS
BEGIN
    UPDATE students SET updated_at = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
go
CREATE TRIGGER trg_teachers_update ON teachers
AFTER UPDATE AS
BEGIN
    UPDATE teachers SET updated_at = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
go
CREATE TRIGGER trg_users_update ON users
AFTER UPDATE AS
BEGIN
    UPDATE users SET updated_at = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
go
CREATE TRIGGER trg_courses_update ON courses
AFTER UPDATE AS
BEGIN
    UPDATE courses SET updated_at = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
go
CREATE TRIGGER trg_classes_update ON classes
AFTER UPDATE AS
BEGIN
    UPDATE classes SET updated_at = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
go
CREATE TRIGGER trg_enrollments_update ON enrollments
AFTER UPDATE AS
BEGIN
    UPDATE enrollments
    SET updated_at = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
GO
CREATE TRIGGER trg_classes_check_dates
ON classes
AFTER INSERT, UPDATE
AS
BEGIN
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN courses c ON i.course_id = c.id
        WHERE i.start_time IS NULL OR i.end_time IS NULL OR c.start_date > c.end_date
    )
    BEGIN
        RAISERROR ('Invalid class times or course date range.', 16, 1);
        ROLLBACK TRANSACTION;
    END
END;
GO
CREATE TRIGGER trg_schedules_check_date
ON schedules
AFTER INSERT, UPDATE
AS
BEGIN
    IF EXISTS (
        SELECT 1
        FROM inserted s
        JOIN classes cls ON s.class_id = cls.id
        JOIN courses crs ON cls.course_id = crs.id
        WHERE s.schedule_date < crs.start_date OR s.schedule_date > crs.end_date
    )
    BEGIN
        RAISERROR ('Schedule date must be within course date range.', 16, 1);
        ROLLBACK TRANSACTION;
    END
END;
GO


ALTER TRIGGER trg_students_update ON students
AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE students 
        SET updated_at = GETDATE()
        WHERE id IN (SELECT id FROM inserted);
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO




CREATE TRIGGER trg_chk_schedule_date
ON schedules
AFTER INSERT, UPDATE
AS
BEGIN
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN classes cls ON i.class_id = cls.id
        JOIN courses crs ON cls.course_id = crs.id
        WHERE i.schedule_date < crs.start_date OR i.schedule_date > crs.end_date
    )
    BEGIN
        RAISERROR ('schedule_date must be within the related course start and end dates.', 16, 1);
        ROLLBACK TRANSACTION;
    END
END;
GO





-- Insert users
INSERT INTO users (username, password, role, created_at, updated_at)
VALUES 
('aaaaaaaaa', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', '2025-05-11 17:23:17.473', '2025-05-11 17:23:17.473'),
('bbbbbbbbbb', '$2b$10$TPE79JXdRYc3c9EnKLLTPe4iSkP.SB3D79RMIIhxmh/tQkS7ezQ.C', 'teacher', '2025-05-11 17:23:32.367', '2025-05-11 17:23:32.367'),
('cccccccccc', '$2b$10$yppnS1aDECiNoIOp76Z4B.2FnkvgAS96liJXsYfemQTpGoISHFVey', 'admin', '2025-05-12 09:37:00.560', '2025-05-12 09:50:10.277');

-- Insert student (assumes user_id = 1)
INSERT INTO students (user_id, full_name, email, phone_number, address, date_of_birth)
VALUES 
(1, 'aaaaaaaaa', 'test@gmail.com', '5646456363', 'djtkjtrfnrt', '2025-05-16');

-- Insert teacher (assumes user_id = 2)
INSERT INTO teachers (user_id, full_name, email, phone_number, address, date_of_birth, salary)
VALUES 
(2, 'bbbbbbbbbb', 'test2@gmail.com', '5646456363', 'djtkjtrfnrt', '2025-05-16', 10000000000000.00);

-- Insert admin info (if you have a table for admins; otherwise skip or create table)
-- Example for a generic profile table if you store additional info:
 INSERT INTO admins (user_id, full_name, email, phone_number, created_at)
 VALUES 
 (3, 'vvvvvvvvvv', 'test3@gmail.com', '5646456363', '2025-05-12 09:37:00.567');

-- Insert courses (with image_path)
INSERT INTO courses (course_name, description, start_date, end_date, tuition_fee, image_path, link)
VALUES 
(N'Khoá học Toán, Lý, Hoá, Anh', 
 N'Các khoá học Toán, Lý, Hoá, Anh được thiết kế phù hợp với từng trình độ, giúp học sinh củng cố kiến thức nền tảng, phát triển tư duy logic và nâng cao kỹ năng ngoại ngữ. Đội ngũ giáo viên chuyên môn, phương pháp giảng dạy hiện đại, hỗ trợ học sinh đạt kết quả cao trong học tập.', 
 '2025-08-01', '2025-08-31', 3000000, 'slide1.jpg', '/Toan,Ly,Hoaclass'),
(N'Khoá học Anh Văn', 
 N'Chương trình Anh văn giúp học sinh phát triển toàn diện các kỹ năng nghe, nói, đọc, viết với giáo viên giàu kinh nghiệm và phương pháp hiện đại.', 
 '2025-09-01', '2025-09-30', 1500000, 'slide2.jpg', '/AnhVanClass'),
(N'Khoá học Văn', 
 N'Khoá học Văn giúp học sinh nâng cao khả năng cảm thụ, phân tích tác phẩm và phát triển kỹ năng viết, trình bày ý tưởng một cách logic, sáng tạo.', 
 '2025-10-01', '2025-10-31', 1800000, 'slide3.jpg', '/VanClass'),
(N'Khoá học Toán', 
 N'Khoá học Toán xây dựng nền tảng vững chắc, phát triển tư duy logic và khả năng giải quyết vấn đề cho học sinh ở mọi cấp độ.', 
 '2025-08-15', '2025-09-15', 2000000, 'slide4.jpg', '/ToanClass'),
(N'Khoá học Lý', 
 N'Khoá học Vật lý giúp học sinh hiểu sâu các khái niệm, vận dụng kiến thức vào thực tiễn và đạt kết quả cao trong các kỳ thi.', 
 '2025-09-05', '2025-10-05', 2000000, 'slide5.png', '/LyClass'),
(N'Khoá học Hoá', 
 N'Chương trình Hoá học chú trọng thực hành, giúp học sinh nắm vững lý thuyết và ứng dụng vào các bài tập, thí nghiệm thực tế.', 
 '2025-10-10', '2025-11-10', 2000000, 'slide6.png', '/HoaClass'),
(N'Khoá học Sử', 
 N'Khoá học Lịch sử giúp học sinh hiểu rõ các sự kiện, nhân vật lịch sử và phát triển tư duy phản biện, phân tích.', 
 '2025-11-01', '2025-11-30', 1700000, 'slide7.jpg', '/SuClass');



-- Insert materials
INSERT INTO materials (course_id, file_name, file_path)
VALUES 
(1, 'Slide bài giảng 1', '/materials/csharp_slide1.pdf');

-- Insert classes
INSERT INTO classes (class_name, course_id, teacher_id, start_time, end_time, weekly_schedule)
VALUES (N'Math A1', 1, 1, '08:00', '10:00', '2,4,6');  -- Tue, Thu, Sat


-- Corrected schedule dates
-- Insert demo class schedule for class_id = 1 and course_id = 1

INSERT INTO schedules (class_id, course_id, day_of_week, schedule_date, start_time, end_time)
VALUES
-- Monday
(1, 1, N'Monday', '2025-08-02', '08:00', '10:00'),
-- Wednesday
(1, 1, N'Wednesday', '2025-08-04', '08:00', '10:00'),
-- Friday
(1, 1, N'Friday', '2025-08-06', '08:00', '10:00');



-- Insert sample enrollment with unpaid status
INSERT INTO enrollments (student_id, class_id, enrollment_date, payment_status, payment_date)
VALUES (1, 1, GETDATE(), 1, GETDATE());



-- Insert notifications
INSERT INTO notifications (user_id, message)
VALUES 
(1, N'Bạn đã được đăng ký vào lớp LTC001.'),
(2, N'Bạn có lớp mới: LTC001.');







-- Delete from tables that depend on others first
DELETE FROM schedules;
DELETE FROM enrollments;
DELETE FROM payments;
DELETE FROM classes;
DELETE FROM materials;
DELETE FROM notifications;
DELETE FROM students;
DELETE FROM teachers;
DELETE FROM courses;
DELETE FROM users;


-- Simulate payment: update payment status and date
UPDATE enrollments
SET payment_status = 1, payment_date = '2025-05-02'
WHERE student_id = 1 AND class_id = 1;


 SELECT s.schedule_date, s.start_time,
             c.class_name, t.full_name AS teacher
      FROM students st
      JOIN enrollments e   ON st.id = e.student_id
      JOIN classes c       ON e.class_id = c.id
      JOIN schedules s     ON c.id = s.class_id
      JOIN teachers t      ON c.teacher_id = t.id






	  SELECT * FROM materials ORDER BY uploaded_at DESC




	SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
       COALESCE(s.full_name, t.full_name, a.full_name) AS full_name,
       COALESCE(s.email, t.email, a.email) AS email,
       COALESCE(s.phone_number, t.phone_number, a.phone) AS phone
FROM users u
LEFT JOIN students s ON u.id = s.user_id
LEFT JOIN teachers t ON u.id = t.user_id
LEFT JOIN admins a   ON u.id = a.user_id
ORDER BY u.created_at DESC;




SELECT 
 c.course_name,
    c.description AS course_description,
    t.full_name AS teacher_name,
    t.email AS teacher_email,
    t.phone_number AS teacher_phone,   
    c.start_date AS course_start,
    c.end_date AS course_end,
    cls.class_name,
    cls.start_time AS class_start_time,
    cls.end_time AS class_end_time,
    s.day_of_week,
    s.schedule_date,
    s.start_time AS schedule_start,
    s.end_time AS schedule_end
FROM classes cls
JOIN teachers t ON cls.teacher_id = t.id
JOIN courses c ON cls.course_id = c.id
LEFT JOIN schedules s ON cls.id = s.class_id
ORDER BY t.full_name, c.course_name, s.schedule_date;



SELECT 
    st.full_name AS student_name,
    st.email AS student_email,
    c.course_name,
    c.description AS course_description,
    t.full_name AS teacher_name,
    t.email AS teacher_email,
    t.phone_number AS teacher_phone,   
    c.start_date AS course_start,
    c.end_date AS course_end,
    cls.class_name,
    cls.start_time AS class_start_time,
    cls.end_time AS class_end_time,
    s.day_of_week,
    s.schedule_date,
    s.start_time AS schedule_start,
    s.end_time AS schedule_end
FROM enrollments e
JOIN students st ON e.student_id = st.id
JOIN classes cls ON e.class_id = cls.id
JOIN teachers t ON cls.teacher_id = t.id
JOIN courses c ON cls.course_id = c.id
LEFT JOIN schedules s ON cls.id = s.class_id
WHERE st.id = 1
ORDER BY c.course_name, s.schedule_date;



SELECT 
    c.course_name,
    c.description AS course_description,
    c.tuition_fee,
    t.full_name AS teacher_name,
    t.email AS teacher_email,
    t.phone_number AS teacher_phone,   
    c.start_date AS course_start,
    c.end_date AS course_end,
    cls.class_name,
    cls.start_time AS class_start_time,
    cls.end_time AS class_end_time,
    s.day_of_week,
    s.schedule_date,
    s.start_time AS schedule_start,
    s.end_time AS schedule_end
FROM classes cls
JOIN teachers t ON cls.teacher_id = t.id
JOIN courses c ON cls.course_id = c.id
LEFT JOIN schedules s ON cls.id = s.class_id
ORDER BY t.full_name, c.course_name, s.schedule_date;





SELECT s.full_name, c.class_name, e.enrollment_date, 
       e.payment_status, e.payment_date
FROM enrollments e
JOIN students s ON e.student_id = s.id
JOIN classes c ON e.class_id = c.id;

SELECT 
        c.class_name,
        co.course_name,
        t.full_name AS teacher,
        cls.start_time,		
        cls.end_time,
        cls.weekly_schedule,
        s.schedule_date AS extra_date,
        s.start_time AS extra_start,
        s.end_time AS extra_end
      FROM students st
      JOIN enrollments e ON st.id = e.student_id
      JOIN classes cls ON e.class_id = cls.id
      JOIN courses co ON cls.course_id = co.id
      JOIN teachers t ON cls.teacher_id = t.id
      LEFT JOIN schedules s ON cls.id = s.class_id

-- First, clear existing schedule data
DELETE FROM schedules WHERE class_id = 1;

-- Insert corrected schedule dates based on weekly_schedule '2,4,6' (Tue, Thu, Sat)
INSERT INTO schedules (class_id, course_id, day_of_week, schedule_date, start_time, end_time)
VALUES
-- Tuesday (2)
(1, 1, N'Tuesday', '2025-06-03', '08:00', '10:00'),
-- Thursday (4)
(1, 1, N'Thursday', '2025-06-05', '08:00', '10:00'),
-- Saturday (6)
(1, 1, N'Saturday', '2025-06-07', '08:00', '10:00');


-- BƯỚC 2: Thêm user và teacher cho 8 giảng viên

INSERT INTO users (username, password, role, created_at, updated_at) VALUES
('nguyenthilan', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()), -- 4
('tranvanminh', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()),  -- 5
('lethihuong', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()),   -- 6
('phamquocanh', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()),  -- 7
('ngothimai', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()),    -- 8
('dangvanson', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()),   -- 9
('vuthithu', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE()),     -- 10
('hoanglong', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'teacher', GETDATE(), GETDATE());    -- 11

-- Lấy user_id tương ứng (giả sử từ 4 đến 11)
INSERT INTO teachers (user_id, full_name, email, phone_number, address, date_of_birth, salary, created_at, updated_at) VALUES
(4, N'Nguyễn Thị Lan', 'lan.ielts@gmail.com', '0901000001', N'Hà Tĩnh', '1990-05-20', 15000000, GETDATE(), GETDATE()),
(5, N'Trần Văn Minh', 'minh.tv@gmail.com', '0901000002', N'Hà Nội', '1985-03-15', 17000000, GETDATE(), GETDATE()),
(6, N'Lê Thị Hương', 'huong.le@gmail.com', '0901000003', N'Hải Phòng', '1992-07-10', 14000000, GETDATE(), GETDATE()),
(7, N'Phạm Quốc Anh', 'quocanh.pham@gmail.com', '0901000004', N'Đà Nẵng', '1988-11-22', 16000000, GETDATE(), GETDATE()),
(8, N'Ngô Thị Mai', 'mai.ngo@gmail.com', '0901000005', N'Hồ Chí Minh', '1991-09-05', 15500000, GETDATE(), GETDATE()),
(9, N'Đặng Văn Sơn', 'son.dang@gmail.com', '0901000006', N'Cần Thơ', '1983-12-30', 18000000, GETDATE(), GETDATE()),
(10, N'Vũ Thị Thu', 'thu.vu@gmail.com', '0901000007', N'Quảng Ninh', '1993-04-18', 14500000, GETDATE(), GETDATE()),
(11, N'Hoàng Long', 'long.hoang@gmail.com', '0901000008', N'Hà Tĩnh', '1980-01-01', 20000000, GETDATE(), GETDATE());

-- BƯỚC 3: Tạo class cho từng giảng viên, gán vào từng khoá học (course_id từ 1 đến 8)
-- Giả sử teacher_id cũng từ 2 (đã có) đến 9 (vừa thêm), course_id từ 1 đến 7 (theo dữ liệu mẫu của bạn)

INSERT INTO classes (class_name, course_id, teacher_id, start_time, end_time, weekly_schedule, created_at, updated_at) VALUES
(N'Toán, Lý, Hoá, Anh - Lớp 1', 1, 4, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE()), -- Nguyễn Thị Lan
(N'Anh Văn - Lớp 1', 2, 5, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE()),             -- Trần Văn Minh
(N'Văn - Lớp 1', 3, 6, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE()),                 -- Lê Thị Hương
(N'Toán - Lớp 1', 4, 7, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE()),                -- Phạm Quốc Anh
(N'Lý - Lớp 1', 5, 8, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE()),                  -- Ngô Thị Mai
(N'Hoá - Lớp 1', 6, 9, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE()),                 -- Đặng Văn Sơn
(N'Sử - Lớp 1', 7, 10, '18:00', '20:00', '2,4,6', GETDATE(), GETDATE());            -- Vũ Thị Thu (gán lại course_id=1 nếu chưa có course kỹ năng)

-- Tạo 64 học sinh mới (8 học sinh cho mỗi lớp từ class_id = 2 đến 9)
-- Lưu ý: Thay 'hashed_password_here' bằng mật khẩu đã mã hoá thực tế

-- 1. Thêm users và students
INSERT INTO users (username, password, role, created_at, updated_at) VALUES
('hs_tlha_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_tlha_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_av_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_av_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_van_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_van_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_toan_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_toan_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_ly_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_ly_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_hoa_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_hoa_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_su_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_su_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),

('hs_kn_01', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_02', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_03', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_04', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_05', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_06', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_07', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE()),
('hs_kn_08', '$2b$10$lWy/3Ogl73Z9eMBxuG3HyuAUbEVCCgCUix6m941PoJEYSKtEfQWdK', 'student', GETDATE(), GETDATE());

-- Giả sử user_id của các học sinh này bắt đầu từ 20 (sau các user đã có)
-- Thêm students (user_id từ 20 đến 83)
INSERT INTO students (user_id, full_name, email, phone_number, address, date_of_birth)
VALUES
(20, N'Nguyễn Văn A1', 'a1@gmail.com', '0903000001', N'Hà Nội', '2007-01-01'),
(21, N'Nguyễn Văn A2', 'a2@gmail.com', '0903000002', N'Hà Nội', '2007-01-02'),
(22, N'Nguyễn Văn A3', 'a3@gmail.com', '0903000003', N'Hà Nội', '2007-01-03'),
(23, N'Nguyễn Văn A4', 'a4@gmail.com', '0903000004', N'Hà Nội', '2007-01-04'),
(24, N'Nguyễn Văn A5', 'a5@gmail.com', '0903000005', N'Hà Nội', '2007-01-05'),
(25, N'Nguyễn Văn A6', 'a6@gmail.com', '0903000006', N'Hà Nội', '2007-01-06'),
(26, N'Nguyễn Văn A7', 'a7@gmail.com', '0903000007', N'Hà Nội', '2007-01-07'),
(27, N'Nguyễn Văn A8', 'a8@gmail.com', '0903000008', N'Hà Nội', '2007-01-08'),

(28, N'Lê Thị B1', 'b1@gmail.com', '0903000011', N'Hà Nam', '2007-02-01'),
(29, N'Lê Thị B2', 'b2@gmail.com', '0903000012', N'Hà Nam', '2007-02-02'),
(30, N'Lê Thị B3', 'b3@gmail.com', '0903000013', N'Hà Nam', '2007-02-03'),
(31, N'Lê Thị B4', 'b4@gmail.com', '0903000014', N'Hà Nam', '2007-02-04'),
(32, N'Lê Thị B5', 'b5@gmail.com', '0903000015', N'Hà Nam', '2007-02-05'),
(33, N'Lê Thị B6', 'b6@gmail.com', '0903000016', N'Hà Nam', '2007-02-06'),
(34, N'Lê Thị B7', 'b7@gmail.com', '0903000017', N'Hà Nam', '2007-02-07'),
(35, N'Lê Thị B8', 'b8@gmail.com', '0903000018', N'Hà Nam', '2007-02-08'),

(36, N'Trần Văn C1', 'c1@gmail.com', '0903000021', N'Hải Dương', '2007-03-01'),
(37, N'Trần Văn C2', 'c2@gmail.com', '0903000022', N'Hải Dương', '2007-03-02'),
(38, N'Trần Văn C3', 'c3@gmail.com', '0903000023', N'Hải Dương', '2007-03-03'),
(39, N'Trần Văn C4', 'c4@gmail.com', '0903000024', N'Hải Dương', '2007-03-04'),
(40, N'Trần Văn C5', 'c5@gmail.com', '0903000025', N'Hải Dương', '2007-03-05'),
(41, N'Trần Văn C6', 'c6@gmail.com', '0903000026', N'Hải Dương', '2007-03-06'),
(42, N'Trần Văn C7', 'c7@gmail.com', '0903000027', N'Hải Dương', '2007-03-07'),
(43, N'Trần Văn C8', 'c8@gmail.com', '0903000028', N'Hải Dương', '2007-03-08'),

(44, N'Phạm Thị D1', 'd1@gmail.com', '0903000031', N'Hưng Yên', '2007-04-01'),
(45, N'Phạm Thị D2', 'd2@gmail.com', '0903000032', N'Hưng Yên', '2007-04-02'),
(46, N'Phạm Thị D3', 'd3@gmail.com', '0903000033', N'Hưng Yên', '2007-04-03'),
(47, N'Phạm Thị D4', 'd4@gmail.com', '0903000034', N'Hưng Yên', '2007-04-04'),
(48, N'Phạm Thị D5', 'd5@gmail.com', '0903000035', N'Hưng Yên', '2007-04-05'),
(49, N'Phạm Thị D6', 'd6@gmail.com', '0903000036', N'Hưng Yên', '2007-04-06'),
(50, N'Phạm Thị D7', 'd7@gmail.com', '0903000037', N'Hưng Yên', '2007-04-07'),
(51, N'Phạm Thị D8', 'd8@gmail.com', '0903000038', N'Hưng Yên', '2007-04-08'),

(52, N'Hoàng Văn E1', 'e1@gmail.com', '0903000041', N'Nam Định', '2007-05-01'),
(53, N'Hoàng Văn E2', 'e2@gmail.com', '0903000042', N'Nam Định', '2007-05-02'),
(54, N'Hoàng Văn E3', 'e3@gmail.com', '0903000043', N'Nam Định', '2007-05-03'),
(55, N'Hoàng Văn E4', 'e4@gmail.com', '0903000044', N'Nam Định', '2007-05-04'),
(56, N'Hoàng Văn E5', 'e5@gmail.com', '0903000045', N'Nam Định', '2007-05-05'),
(57, N'Hoàng Văn E6', 'e6@gmail.com', '0903000046', N'Nam Định', '2007-05-06'),
(58, N'Hoàng Văn E7', 'e7@gmail.com', '0903000047', N'Nam Định', '2007-05-07'),
(59, N'Hoàng Văn E8', 'e8@gmail.com', '0903000048', N'Nam Định', '2007-05-08'),

(60, N'Vũ Thị F1', 'f1@gmail.com', '0903000051', N'Ninh Bình', '2007-06-01'),
(61, N'Vũ Thị F2', 'f2@gmail.com', '0903000052', N'Ninh Bình', '2007-06-02'),
(62, N'Vũ Thị F3', 'f3@gmail.com', '0903000053', N'Ninh Bình', '2007-06-03'),
(63, N'Vũ Thị F4', 'f4@gmail.com', '0903000054', N'Ninh Bình', '2007-06-04'),
(64, N'Vũ Thị F5', 'f5@gmail.com', '0903000055', N'Ninh Bình', '2007-06-05'),
(65, N'Vũ Thị F6', 'f6@gmail.com', '0903000056', N'Ninh Bình', '2007-06-06'),
(66, N'Vũ Thị F7', 'f7@gmail.com', '0903000057', N'Ninh Bình', '2007-06-07'),
(67, N'Vũ Thị F8', 'f8@gmail.com', '0903000058', N'Ninh Bình', '2007-06-08'),

(68, N'Đặng Văn G1', 'g1@gmail.com', '0903000061', N'Thanh Hoá', '2007-07-01'),
(69, N'Đặng Văn G2', 'g2@gmail.com', '0903000062', N'Thanh Hoá', '2007-07-02'),
(70, N'Đặng Văn G3', 'g3@gmail.com', '0903000063', N'Thanh Hoá', '2007-07-03'),
(71, N'Đặng Văn G4', 'g4@gmail.com', '0903000064', N'Thanh Hoá', '2007-07-04'),
(72, N'Đặng Văn G5', 'g5@gmail.com', '0903000065', N'Thanh Hoá', '2007-07-05'),
(73, N'Đặng Văn G6', 'g6@gmail.com', '0903000066', N'Thanh Hoá', '2007-07-06'),
(74, N'Đặng Văn G7', 'g7@gmail.com', '0903000067', N'Thanh Hoá', '2007-07-07'),
(75, N'Đặng Văn G8', 'g8@gmail.com', '0903000068', N'Thanh Hoá', '2007-07-08'),

(76, N'Bùi Thị H1', 'h1@gmail.com', '0903000071', N'Hà Tĩnh', '2007-08-01'),
(77, N'Bùi Thị H2', 'h2@gmail.com', '0903000072', N'Hà Tĩnh', '2007-08-02'),
(78, N'Bùi Thị H3', 'h3@gmail.com', '0903000073', N'Hà Tĩnh', '2007-08-03'),
(79, N'Bùi Thị H4', 'h4@gmail.com', '0903000074', N'Hà Tĩnh', '2007-08-04'),
(80, N'Bùi Thị H5', 'h5@gmail.com', '0903000075', N'Hà Tĩnh', '2007-08-05'),
(81, N'Bùi Thị H6', 'h6@gmail.com', '0903000076', N'Hà Tĩnh', '2007-08-06'),
(82, N'Bùi Thị H7', 'h7@gmail.com', '0903000077', N'Hà Tĩnh', '2007-08-07'),
(83, N'Bùi Thị H8', 'h8@gmail.com', '0903000078', N'Hà Tĩnh', '2007-08-08');

-- 2. Đăng ký mỗi học sinh vào đúng 1 lớp (class_id từ 2 đến 9)
INSERT INTO enrollments (student_id, class_id, enrollment_date, payment_status, payment_date)
VALUES

(174, 2, GETDATE(), 1, GETDATE()), (175, 2, GETDATE(), 1, GETDATE()), (176, 2, GETDATE(), 1, GETDATE()), (177, 2, GETDATE(), 1, GETDATE()),
(178, 2, GETDATE(), 1, GETDATE()), (179, 2, GETDATE(), 1, GETDATE()), (180, 2, GETDATE(), 1, GETDATE()), (181, 2, GETDATE(), 1, GETDATE()),

(182, 3, GETDATE(), 1, GETDATE()), (183, 3, GETDATE(), 1, GETDATE()), (184, 3, GETDATE(), 1, GETDATE()), (185, 3, GETDATE(), 1, GETDATE()),
(186, 3, GETDATE(), 1, GETDATE()), (187, 3, GETDATE(), 1, GETDATE()), (188, 3, GETDATE(), 1, GETDATE()), (230, 3, GETDATE(), 1, GETDATE()),

(231, 4, GETDATE(), 1, GETDATE()), (232, 4, GETDATE(), 1, GETDATE()), (233, 4, GETDATE(), 1, GETDATE()), (234, 4, GETDATE(), 1, GETDATE()),
(235, 4, GETDATE(), 1, GETDATE()), (236, 4, GETDATE(), 1, GETDATE()), (237, 4, GETDATE(), 1, GETDATE()), (238, 4, GETDATE(), 1, GETDATE()),

(239, 5, GETDATE(), 1, GETDATE()), (240, 5, GETDATE(), 1, GETDATE()), (241, 5, GETDATE(), 1, GETDATE()), (242, 5, GETDATE(), 1, GETDATE()),
(243, 5, GETDATE(), 1, GETDATE()), (244, 5, GETDATE(), 1, GETDATE()), (245, 5, GETDATE(), 1, GETDATE()), (246, 5, GETDATE(), 1, GETDATE()),

(247, 6, GETDATE(), 1, GETDATE()), (248, 6, GETDATE(), 1, GETDATE()), (249, 6, GETDATE(), 1, GETDATE()), (250, 6, GETDATE(), 1, GETDATE()),
(251, 6, GETDATE(), 1, GETDATE()), (252, 6, GETDATE(), 1, GETDATE()), (253, 6, GETDATE(), 1, GETDATE()), (254, 6, GETDATE(), 1, GETDATE()),

(255, 7, GETDATE(), 1, GETDATE()), (256, 7, GETDATE(), 1, GETDATE()), (257, 7, GETDATE(), 1, GETDATE()), (258, 7, GETDATE(), 1, GETDATE()),
(259, 7, GETDATE(), 1, GETDATE()), (260, 7, GETDATE(), 1, GETDATE()), (261, 7, GETDATE(), 1, GETDATE()), (262, 7, GETDATE(), 1, GETDATE()),

(263, 8, GETDATE(), 1, GETDATE()), (264, 8, GETDATE(), 1, GETDATE()), (265, 8, GETDATE(), 1, GETDATE()), (266, 8, GETDATE(), 1, GETDATE()),
(267, 8, GETDATE(), 1, GETDATE()), (268, 8, GETDATE(), 1, GETDATE()), (269, 8, GETDATE(), 1, GETDATE()), (271, 8, GETDATE(), 1, GETDATE()),

(272, 9, GETDATE(), 1, GETDATE()), (273, 9, GETDATE(), 1, GETDATE()), (274, 9, GETDATE(), 1, GETDATE()), (275, 9, GETDATE(), 1, GETDATE()),
(276, 9, GETDATE(), 1, GETDATE()), (277, 9, GETDATE(), 1, GETDATE()), (278, 9, GETDATE(), 1, GETDATE()), (287, 9, GETDATE(), 1, GETDATE());