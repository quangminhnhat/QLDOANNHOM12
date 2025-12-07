//lib import
const express = require("express");
const router = express.Router();
const path = require("path");
const bcrypt = require("bcrypt");
const sql = require("msnodesqlv8");
const multer = require("multer");
const fs = require("fs");
const { authenticateRole } = require("../middleware/roleAuth");
const executeQuery = require("../middleware/executeQuery");
const { createMCQQuestion, editMCQQuestion, deleteMCQQuestion } = require("../middleware/mcqQuestionHelper");
const {
  checkAuthenticated,
  checkNotAuthenticated,
} = require("../middleware/auth");

// Configure multer for question media uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/exam_media';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Render exam list page
router.get('/exams', checkAuthenticated, async (req, res) => {
  try {
    let query = '';
    const userRole = req.user.role.toLowerCase();

    if (userRole === 'admin') {
      // Admin can see all exams
      query = `
        SELECT e.*, t.full_name as teacher_name 
        FROM Exams e 
        JOIN teachers te ON e.teachers_id = te.id
        JOIN users t ON te.user_id = t.id
      `;
    } else if (userRole === 'teacher') {
      // Teachers can only see their own exams
      query = `
        SELECT e.*, t.full_name as teacher_name 
        FROM Exams e 
        JOIN teachers te ON e.teachers_id = te.id
        JOIN users t ON te.user_id = t.id
        WHERE te.user_id = ${req.user.id}
      `;
    } else if (userRole === 'student') {
      // Get both assigned and attempted exams for students, including separate assignments of the same exam in different classes
      query = `
        WITH LatestAttempts AS (
          SELECT 
            assignment_id,
            attempt_id,
            total_score,
            status as attempt_status,
            COUNT(*) OVER (PARTITION BY assignment_id, student_id) as attempt_count,
            ROW_NUMBER() OVER (PARTITION BY assignment_id, student_id ORDER BY attempt_no DESC) as rn
          FROM Attempts
          WHERE status != 'in_progress' AND student_id = (
            SELECT id FROM students WHERE user_id = ${req.user.id}
          )
        )
        SELECT DISTINCT
          e.*,
          t.full_name as teacher_name,
          CASE 
            WHEN a.attempt_status = 'completed' THEN 'Completed'
            WHEN a.attempt_status = 'in_progress' THEN 'In Progress'
            WHEN ea.open_at <= GETDATE() AND ea.close_at >= GETDATE() AND 
                 (a.attempt_count IS NULL OR 
                  (ea.max_attempts IS NULL OR a.attempt_count < ea.max_attempts)) THEN 'Available'
            WHEN ea.open_at > GETDATE() THEN 'Upcoming'
            ELSE 'Expired'
          END as exam_status,
          CASE 
            WHEN a.attempt_status = 'in_progress' THEN 0
            WHEN ea.open_at <= GETDATE() AND ea.close_at >= GETDATE() AND 
                 (a.attempt_count IS NULL OR 
                  (ea.max_attempts IS NULL OR a.attempt_count < ea.max_attempts)) THEN 1
            WHEN ea.open_at > GETDATE() THEN 2
            ELSE 3
          END as status_order,
          a.total_score,
          a.attempt_status,
          ea.open_at,
          ea.close_at,
          ea.assignment_id,
          ea.max_attempts,
          ISNULL(a.attempt_count, 0) as attempt_count,
          s.id as student_id,
          en.class_id,
          c.class_name
        FROM Exams e 
        JOIN teachers te ON e.teachers_id = te.id
        JOIN users t ON te.user_id = t.id
        JOIN ExamAssignments ea ON e.exam_id = ea.exam_id
        JOIN classes c ON ea.classes_id = c.id
        JOIN enrollments en ON c.id = en.class_id AND en.student_id = (
          SELECT id FROM students WHERE user_id = ${req.user.id}
        )
        JOIN students s ON s.id = en.student_id
        LEFT JOIN LatestAttempts a ON ea.assignment_id = a.assignment_id AND a.rn = 1
        WHERE s.user_id = ${req.user.id}
        ORDER BY status_order, ea.open_at ASC
      `;
    } else {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    const exams = await executeQuery(query);
    
    res.render('exams/examList', {
      user: req.user,
      exams: exams,
      flashMessage: req.flash('message')
    });
  } catch (error) {
    console.error(error);
    req.flash('message', { type: 'danger', message: 'Error fetching exams' });
    res.redirect('/');
  }
});

// Render new exam page
router.get('/exams/new', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  res.render('exams/examNew', {
    user: req.user,
    flashMessage: req.flash('message')
  });
});

// Create new exam
router.post('/exam/new', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { exam_title, description, duration_minutes, total_marks, passing_marks } = req.body;
    
    // Get teacher_id from the authenticated user
    const teacherQuery = `
      SELECT t.id FROM teachers t 
      JOIN users u ON t.user_id = u.id 
      WHERE u.id = ${req.user.id}
    `;
    const teacher = await executeQuery(teacherQuery);
    
    if (!teacher || teacher.length === 0) {
      return res.status(403).json({ message: "Only teachers can create exams" });
    }

    // Generate a unique exam code
    const examCode = 'EXAM' + Date.now().toString().slice(-6);
    
    const query = `
      INSERT INTO Exams (teachers_id, exam_code, exam_title, description, duration_min, total_points, passing_points, created_at)
      OUTPUT INSERTED.exam_id
      VALUES (${teacher[0].id}, '${examCode}', '${exam_title}', '${description}', ${duration_minutes}, ${total_marks}, ${passing_marks || 'NULL'}, GETDATE())
    `;
    const result = await executeQuery(query);
    res.status(201).json({ 
      message: "Exam created successfully",
      examId: result[0].exam_id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating exam" });
  }
});

// Get new question page
router.get('/exams/:examId/questions/new', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { examId } = req.params;

    // Verify teacher owns this exam
    const verifyQuery = `
      SELECT e.*, t.user_id as teacher_user_id
      FROM Exams e
      JOIN teachers t ON e.teachers_id = t.id
      WHERE e.exam_id = ${examId}
    `;
    const exam = await executeQuery(verifyQuery);

    if (!exam || exam.length === 0) {
      req.flash('message', { type: 'danger', message: 'Exam not found' });
      return res.redirect('/exams');
    }

    if (exam[0].teacher_user_id !== req.user.id) {
      req.flash('message', { type: 'danger', message: 'You do not have permission to add questions to this exam' });
      return res.redirect('/exams');
    }

    res.render('exams/questionNew', {
      user: req.user,
      examId: examId,
      flashMessage: req.flash('message')
    });
  } catch (error) {
    console.error(error);
    req.flash('message', { type: 'danger', message: 'Error loading question form' });
    res.redirect('/exams');
  }
});

// Get exam edit page
router.get('/exams/:examId/edit', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { examId } = req.params;

    // Get exam details
    const examQuery = `
      SELECT e.*, t.user_id as teacher_user_id
      FROM Exams e
      JOIN teachers t ON e.teachers_id = t.id
      WHERE e.exam_id = ${examId}
    `;
    const exam = await executeQuery(examQuery);

    if (!exam || exam.length === 0) {
      req.flash('message', { type: 'danger', message: 'Exam not found' });
      return res.redirect('/exams');
    }

    // Verify teacher owns this exam
    if (exam[0].teacher_user_id !== req.user.id) {
      req.flash('message', { type: 'danger', message: 'You do not have permission to edit this exam' });
      return res.redirect('/exams');
    }

    // Get exam questions
    const questionsQuery = `
      SELECT q.*, qt.type_name
      FROM Questions q
      JOIN QuestionTypes qt ON q.type_id = qt.type_id
      WHERE q.exam_id = ${examId}
      ORDER BY q.created_at
    `;
    const questions = await executeQuery(questionsQuery);

    res.render('exams/examEdit', {
      user: req.user,
      exam: exam[0],
      questions: questions
    });
  } catch (error) {
    console.error(error);
    req.flash('message', { type: 'danger', message: 'Error loading exam' });
    res.redirect('/exams');
  }
});

// Update exam
router.put('/exams/:examId', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { examId } = req.params;
    const { exam_title, description, duration_minutes, total_marks, passing_marks } = req.body;

    // Verify teacher owns this exam
    const verifyQuery = `
      SELECT e.*
      FROM Exams e
      JOIN teachers t ON e.teachers_id = t.id
      WHERE e.exam_id = ${examId}
      AND t.user_id = ${req.user.id}
    `;
    const exam = await executeQuery(verifyQuery);

    if (!exam || exam.length === 0) {
      return res.status(403).json({ 
        success: false,
        message: "You don't have permission to edit this exam" 
      });
    }

    // Update exam
    const updateQuery = `
      UPDATE Exams 
      SET exam_title = '${exam_title}',
          description = '${description}',
          duration_min = ${duration_minutes},
          total_points = ${total_marks},
          passing_points = ${passing_marks || 'NULL'},
          updated_at = GETDATE()
      WHERE exam_id = ${examId}
    `;
    await executeQuery(updateQuery);

    res.json({ 
      success: true,
      message: "Exam updated successfully" 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: "Error updating exam" 
    });
  }
});

// Get question edit page
router.get('/questions/:questionId/edit', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { questionId } = req.params;

    // Get question details with media and options
    const questionQuery = `
      SELECT q.*, qt.type_name,
             (SELECT ISNULL(
               (SELECT mo.* 
               FROM MCQOptions mo 
               WHERE mo.question_id = q.question_id 
               FOR JSON PATH), '[]')
             ) as options,
             (SELECT JSON_QUERY((
               SELECT qm.* 
               FROM QuestionMedia qm 
               WHERE qm.question_id = q.question_id 
               FOR JSON PATH
             ))) as media,
             e.exam_id,
             t.user_id as teacher_user_id
      FROM Questions q
      JOIN QuestionTypes qt ON q.type_id = qt.type_id
      LEFT JOIN Exams e ON q.exam_id = e.exam_id
      LEFT JOIN teachers t ON e.teachers_id = t.id
      WHERE q.question_id = ${questionId}
    `;
    
    const question = await executeQuery(questionQuery);

    if (!question || question.length === 0) {
      req.flash('message', { type: 'danger', message: 'Question not found' });
      return res.redirect('/exams');
    }

    // If question belongs to an exam, verify teacher owns it
    if (question[0].exam_id && question[0].teacher_user_id !== req.user.id) {
      req.flash('message', { type: 'danger', message: 'You do not have permission to edit this question' });
      return res.redirect('/exams');
    }

    // Parse the JSON strings from SQL
    const questionData = {
      ...question[0],
      options: JSON.parse(question[0].options || '[]'),
      media: JSON.parse(question[0].media || '[]')
    };

    res.render('exams/questionEdit', {
      user: req.user,
      question: questionData,
      examId: questionData.exam_id
    });
  } catch (error) {
    console.error(error);
    req.flash('message', { type: 'danger', message: 'Error loading question' });
    res.redirect('/exams');
  }
});

// Update question
// Delete question media
router.delete('/questions/media/:mediaId', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
    try {
        const { mediaId } = req.params;

        // Get media info and verify ownership
        const mediaQuery = `
            SELECT qm.*, q.exam_id, t.user_id as teacher_user_id 
            FROM QuestionMedia qm
            JOIN Questions q ON qm.question_id = q.question_id
            LEFT JOIN Exams e ON q.exam_id = e.exam_id
            LEFT JOIN teachers t ON e.teachers_id = t.id
            WHERE qm.media_id = ${mediaId}
        `;
        
        const media = await executeQuery(mediaQuery);

        if (!media || media.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Media not found"
            });
        }

        // If media belongs to an exam question, verify teacher owns it
        if (media[0].exam_id && media[0].teacher_user_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to delete this media"
            });
        }

        // Delete the file from disk if it exists
        try {
            const filePath = path.join(__dirname, '..', media[0].file_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            console.error('Error deleting file:', error);
            // Continue with database deletion even if file deletion fails
        }

        // Delete from database
        await executeQuery(`DELETE FROM QuestionMedia WHERE media_id = ${mediaId}`);

        res.json({
            success: true,
            message: "Media deleted successfully"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error deleting media"
        });
    }
});

router.put('/questions/:questionId', checkAuthenticated, authenticateRole(['teacher']), upload.array('media'), async (req, res) => {
  try {
    const { questionId } = req.params;
    const { question_text, points, difficulty, type_id } = req.body;
    const files = req.files;

    // Verify the question exists and belongs to the teacher
    const verifyQuery = `
      SELECT q.*, e.teachers_id 
      FROM Questions q
      LEFT JOIN Exams e ON q.exam_id = e.exam_id
      WHERE q.question_id = ${questionId}
    `;
    const question = await executeQuery(verifyQuery);

    if (!question || question.length === 0) {
      return res.status(404).json({ message: "Question not found" });
    }

    // If it's an MCQ question
    if (type_id === 1 || question[0].type_id === 1) {
      const mcqResult = await editMCQQuestion(questionId, {
        points,
        body_text: question_text,
        difficulty,
        options: req.body.options
      }, files);

      if (!mcqResult.success) {
        throw new Error(mcqResult.error);
      }

      return res.status(200).json({ 
        message: mcqResult.message,
        questionId: mcqResult.questionId 
      });
    }

    // For other question types...
    const updateQuery = `
      UPDATE Questions 
      SET points = ${points},
          body_text = '${question_text}',
          difficulty = ${difficulty || 'NULL'},
          updated_at = GETDATE()
      WHERE question_id = ${questionId}
    `;
    await executeQuery(updateQuery);

    // Handle media files if any
    if (files && files.length > 0) {
      // Delete existing media
      await executeQuery(`DELETE FROM QuestionMedia WHERE question_id = ${questionId}`);
      
      // Add new media files
      for (const file of files) {
        const mediaQuery = `
          INSERT INTO QuestionMedia (question_id, file_name, file_url, caption, file_data, created_at)
          VALUES (${questionId}, '${file.originalname}', '${file.path}', NULL, NULL, GETDATE())
        `;
        await executeQuery(mediaQuery);
      }
    }

    res.status(200).json({ message: "Question updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating question" });
  }
});

// Delete question
router.delete('/questions/:questionId', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { questionId } = req.params;

    // Verify the question exists and belongs to the teacher
    const verifyQuery = `
      SELECT q.*, e.teachers_id 
      FROM Questions q
      LEFT JOIN Exams e ON q.exam_id = e.exam_id
      WHERE q.question_id = ${questionId}
    `;
    const question = await executeQuery(verifyQuery);

    if (!question || question.length === 0) {
      return res.status(404).json({ message: "Question not found" });
    }

    // Verify teacher owns this question
    const teacherQuery = `
      SELECT id FROM teachers 
      WHERE user_id = ${req.user.id}
    `;
    const teacher = await executeQuery(teacherQuery);

    if (question[0].exam_id && teacher[0].id !== question[0].teachers_id) {
      return res.status(403).json({ message: "You don't have permission to delete this question" });
    }

    // If it's an MCQ question
    if (question[0].type_id === 1) {
      const mcqResult = await deleteMCQQuestion(questionId);

      if (!mcqResult.success) {
        throw new Error(mcqResult.error);
      }

      return res.status(200).json({ message: mcqResult.message });
    }

    // For other question types...
    // Delete associated media first
    await executeQuery(`DELETE FROM QuestionMedia WHERE question_id = ${questionId}`);
    
    // Delete the question
    await executeQuery(`DELETE FROM Questions WHERE question_id = ${questionId}`);

    res.status(200).json({ message: "Question deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting question" });
  }
});

// Delete exam
router.delete('/exams/:examId', checkAuthenticated, authenticateRole(['admin', 'teacher']), async (req, res) => {
  try {
    const { examId } = req.params;

    // If teacher, verify they own the exam
    if (req.user.role === 'teacher') {
      const verifyQuery = `
        SELECT e.* 
        FROM Exams e
        JOIN teachers t ON e.teachers_id = t.id
        WHERE e.exam_id = ${examId}
        AND t.user_id = ${req.user.id}
      `;
      const exam = await executeQuery(verifyQuery);

      if (!exam || exam.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: "You don't have permission to delete this exam" 
        });
      }
    }

    // Delete all related records in order
    // First delete all responses and their media
    await executeQuery(`
      DELETE rm 
      FROM ResponseMedia rm
      JOIN Responses r ON rm.response_id = r.response_id
      JOIN Attempts a ON r.attempt_id = a.attempt_id
      JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
      WHERE ea.exam_id = ${examId}
    `);

    // Delete responses
    await executeQuery(`
      DELETE r
      FROM Responses r
      JOIN Attempts a ON r.attempt_id = a.attempt_id
      JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
      WHERE ea.exam_id = ${examId}
    `);

    // Delete attempts
    await executeQuery(`
      DELETE a
      FROM Attempts a
      JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
      WHERE ea.exam_id = ${examId}
    `);

    // Delete assignments
    await executeQuery(`
      DELETE FROM ExamAssignments WHERE exam_id = ${examId}
    `);

    // Delete question media
    await executeQuery(`
      DELETE qm
      FROM QuestionMedia qm
      JOIN Questions q ON qm.question_id = q.question_id
      WHERE q.exam_id = ${examId}
    `);

    // Delete MCQ options
    await executeQuery(`
      DELETE mo
      FROM MCQOptions mo
      JOIN Questions q ON mo.question_id = q.question_id
      WHERE q.exam_id = ${examId}
    `);

    // Delete questions
    await executeQuery(`
      DELETE FROM Questions WHERE exam_id = ${examId}
    `);

    // Finally delete the exam
    await executeQuery(`
      DELETE FROM Exams WHERE exam_id = ${examId}
    `);

    res.json({ 
      success: true,
      message: "Exam deleted successfully" 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: "Error deleting exam" 
    });
  }
});

// Add question to exam or question bank
router.post('/:examId/questions/add', checkAuthenticated, authenticateRole(['teacher']), upload.array('media'), async (req, res) => {
  try {
    const { question_text, type_id, points, difficulty } = req.body;
    const { examId } = req.params;
    const files = req.files;

    // For MCQ questions, use the helper function
    if (type_id === '1') {
      const mcqResult = await createMCQQuestion(examId, {
        points,
        body_text: question_text,
        difficulty,
        options: req.body.options
      }, files);

      if (!mcqResult.success) {
        throw new Error(mcqResult.error);
      }

      return res.status(201).json({ 
        success: true,
        message: mcqResult.message,
        questionId: mcqResult.questionId 
      });
    }

    // For other question types
    const questionQuery = `
      INSERT INTO Questions (exam_id, type_id, points, body_text, difficulty, created_at)
      OUTPUT INSERTED.question_id
      VALUES (${examId === 'bank' ? 'NULL' : examId}, ${type_id}, ${points}, '${question_text}', ${difficulty || 'NULL'}, GETDATE())
    `;
    const question = await executeQuery(questionQuery);
    const questionId = question[0].question_id;

    // Handle media files if any
    if (files && files.length > 0) {
      for (const file of files) {
        const mediaQuery = `
          INSERT INTO QuestionMedia (question_id, file_name, file_url, caption, file_data, created_at)
          VALUES (${questionId}, '${file.originalname}', '${file.path}', NULL, NULL, GETDATE())
        `;
        await executeQuery(mediaQuery);
      }
    }

    // If it's MCQ type, use the dedicated helper function
    if (type_id === 1) {
      const mcqResult = await createMCQQuestion(examId, {
        points,
        body_text,
        difficulty,
        options: req.body.options
      }, files);

      if (!mcqResult.success) {
        throw new Error(mcqResult.error);
      }

      return res.status(201).json({ 
        message: mcqResult.message,
        questionId: mcqResult.questionId 
      });
    }

    res.status(201).json({ 
      message: examId === 'bank' ? "Question added to bank successfully" : "Question added to exam successfully",
      questionId: questionId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding question" });
  }
});

// Get exam questions
router.get('/:examId/questions', checkAuthenticated, async (req, res) => {
  try {
    const { examId } = req.params;
    const query = `
      SELECT q.*, qt.type_name, 
             (SELECT JSON_QUERY((
               SELECT mo.* 
               FROM MCQOptions mo 
               WHERE mo.question_id = q.question_id 
               FOR JSON PATH
             ))) as options,
             (SELECT JSON_QUERY((
               SELECT qm.* 
               FROM QuestionMedia qm 
               WHERE qm.question_id = q.question_id 
               FOR JSON PATH
             ))) as media
      FROM Questions q
      JOIN QuestionTypes qt ON q.type_id = qt.type_id
      WHERE q.exam_id = ${examId}
    `;
    const questions = await executeQuery(query);
    res.json(questions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching questions" });
  }
});

// Get exam assignments page
router.get('/exams/:examId/assign', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { examId } = req.params;

    // Get exam details
    const examQuery = `
      SELECT e.*, t.user_id as teacher_user_id
      FROM Exams e
      JOIN teachers t ON e.teachers_id = t.id
      WHERE e.exam_id = ${examId}
    `;
    const exam = await executeQuery(examQuery);

    if (!exam || exam.length === 0) {
      req.flash('message', { type: 'danger', message: 'Exam not found' });
      return res.redirect('/exams');
    }

    // Verify teacher owns this exam
    if (exam[0].teacher_user_id !== req.user.id) {
      req.flash('message', { type: 'danger', message: 'Unauthorized access' });
      return res.redirect('/exams');
    }

    // Get current assignments with student counts
    const assignmentsQuery = `
      SELECT ea.*, c.class_name,
             (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id) as student_count
      FROM ExamAssignments ea
      JOIN classes c ON ea.classes_id = c.id
      WHERE ea.exam_id = ${examId}
      ORDER BY ea.open_at DESC
    `;
    const assignments = await executeQuery(assignmentsQuery);

    // Get available classes (not yet assigned)
    const availableClassesQuery = `
      SELECT c.* 
      FROM classes c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.user_id = ${req.user.id}
      AND NOT EXISTS (
        SELECT 1 FROM ExamAssignments ea
        WHERE ea.classes_id = c.id
        AND ea.exam_id = ${examId}
      )
    `;
    const availableClasses = await executeQuery(availableClassesQuery);

    res.render('exams/examAssignments', {
      user: req.user,
      exam: exam[0],
      assignments: assignments,
      availableClasses: availableClasses,
      flashMessage: req.flash('message')
    });
  } catch (error) {
    console.error(error);
    req.flash('message', { type: 'danger', message: 'Error loading assignments' });
    res.redirect('/exams');
  }
});

// Assign exam to class
router.post('/exams/:examId/assign', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { examId } = req.params;
    const { class_id, open_at, close_at, max_attempts } = req.body;

    // Verify exam exists and belongs to teacher
    const examQuery = `
      SELECT e.*, t.user_id as teacher_user_id 
      FROM Exams e
      JOIN teachers t ON e.teachers_id = t.id
      WHERE e.exam_id = ${examId}
    `;
    const exam = await executeQuery(examQuery);

    if (!exam || exam.length === 0 || exam[0].teacher_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    // Verify class exists and belongs to teacher
    const classQuery = `
      SELECT c.* 
      FROM classes c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE c.id = ${class_id}
      AND t.user_id = ${req.user.id}
    `;
    const classResult = await executeQuery(classQuery);

    if (!classResult || classResult.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid class' });
    }

    // Create assignment
    // Convert ISO datetime string to SQL Server datetime format
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toISOString().slice(0, 19).replace('T', ' ');
    };

    const insertQuery = `
      INSERT INTO ExamAssignments (exam_id, classes_id, open_at, close_at, max_attempts, created_at)
      VALUES (${examId}, ${class_id}, '${formatDate(open_at)}', '${formatDate(close_at)}', ${max_attempts || 'NULL'}, GETDATE())
    `;
    await executeQuery(insertQuery);

    res.json({ success: true, message: 'Exam assigned successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error assigning exam' });
  }
});

// View exam assignment scores
router.get('/exams/assignments/:assignmentId/scores', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
    try {
        const { assignmentId } = req.params;

        // Get assignment details with exam and class info
        const assignmentQuery = `
            SELECT ea.*, e.exam_title, e.exam_code, c.class_name,
                   t.user_id as teacher_user_id
            FROM ExamAssignments ea
            JOIN Exams e ON ea.exam_id = e.exam_id
            JOIN classes c ON ea.classes_id = c.id
            JOIN teachers t ON e.teachers_id = t.id
            WHERE ea.assignment_id = ${assignmentId}
        `;
        const assignments = await executeQuery(assignmentQuery);

        if (!assignments || assignments.length === 0) {
            req.flash('message', { type: 'danger', message: 'Assignment not found' });
            return res.redirect('/exams');
        }

        // Verify teacher owns this exam
        if (assignments[0].teacher_user_id !== req.user.id) {
            req.flash('message', { type: 'danger', message: 'You do not have permission to view these scores' });
            return res.redirect('/exams');
        }

        // Get student scores with latest attempts
        const scoresQuery = `
            WITH LatestAttempts AS (
                SELECT 
                    student_id,
                    MAX(attempt_no) as latest_attempt_no,
                    assignment_id
                FROM Attempts
                WHERE assignment_id = ${assignmentId}
                GROUP BY student_id, assignment_id
            )
      SELECT DISTINCT
        s.id as student_id,
        u.full_name as student_name,
        a.attempt_id,
        a.attempt_no,
        a.total_score as score,
        a.manual_score,
        a.started_at,
        a.submitted_at,
        a.status,
        CASE 
          WHEN a.status = 'graded' THEN 'Completed'
          WHEN a.submitted_at IS NOT NULL THEN 'Awaiting Grading'
          WHEN a.started_at IS NOT NULL THEN 'In Progress'
          ELSE 'Not Started'
        END as status_text
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN enrollments e ON s.id = e.student_id
            LEFT JOIN LatestAttempts la ON s.id = la.student_id
            LEFT JOIN Attempts a ON (
                s.id = a.student_id 
                AND a.assignment_id = ${assignmentId}
                AND a.attempt_no = la.latest_attempt_no
                AND a.assignment_id = la.assignment_id
            )
            WHERE e.class_id = ${assignments[0].classes_id}
            ORDER BY u.full_name
        `;

        const scores = await executeQuery(scoresQuery);

        res.render('exams/assignmentScores', {
            user: req.user,
            assignment: assignments[0],
            scores: scores,
            flashMessage: req.flash('message')
        });
    } catch (error) {
        console.error(error);
        req.flash('message', { type: 'danger', message: 'Error loading scores' });
        res.redirect('/exams');
    }
});

// Teacher: view grading page for a specific attempt
router.get('/exams/attempts/:attemptId/grade', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { attemptId } = req.params;

    // Get attempt, assignment, exam and teacher
    const attemptQuery = `
      SELECT a.*, ea.assignment_id, ea.exam_id, e.exam_title, t.user_id as teacher_user_id, s.id as student_id, u.full_name
      FROM Attempts a
      JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
      JOIN Exams e ON ea.exam_id = e.exam_id
      JOIN teachers t ON e.teachers_id = t.id
      JOIN students s ON a.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE a.attempt_id = ${attemptId}
    `;

    const attemptRes = await executeQuery(attemptQuery);
    if (!attemptRes || attemptRes.length === 0) {
      req.flash('message', { type: 'danger', message: 'Attempt not found' });
      return res.redirect('/exams');
    }

    const attempt = attemptRes[0];

    // Verify teacher owns this exam
    if (attempt.teacher_user_id !== req.user.id) {
      req.flash('message', { type: 'danger', message: 'You do not have permission to grade this attempt' });
      return res.redirect('/exams');
    }

    // Get responses and related data
    const responsesQuery = `
      SELECT r.*, q.body_text, qt.type_code, rm.file_name, rm.file_url, oi.display_label
      FROM Responses r
      JOIN Questions q ON r.question_id = q.question_id
      JOIN QuestionTypes qt ON q.type_id = qt.type_id
      LEFT JOIN ResponseMedia rm ON r.response_id = rm.response_id
      LEFT JOIN OptionInstances oi ON r.chosen_option_instance_id = oi.option_instance_id
      WHERE r.attempt_id = ${attemptId}
      ORDER BY r.response_id
    `;

    const responsesRaw = await executeQuery(responsesQuery);

    // Group files per response
    const responsesMap = {};
    responsesRaw.forEach(r => {
      if (!responsesMap[r.response_id]) {
        responsesMap[r.response_id] = {
          response_id: r.response_id,
          question_id: r.question_id,
          body_text: r.body_text,
          type_code: r.type_code,
          essay_text: r.essay_text,
          score_awarded: r.score_awarded,
          grader_comment: r.grader_comment,
          files: [],
          display_label: r.display_label
        };
      }
      if (r.file_url) {
        responsesMap[r.response_id].files.push({ name: r.file_name, url: r.file_url });
      }
    });

    const responses = Object.values(responsesMap);

    res.render('exams/gradeAttempt', {
      user: req.user,
      attempt: attempt,
      student: { id: attempt.student_id, full_name: attempt.full_name },
      responses: responses
    });

  } catch (error) {
    console.error(error);
    req.flash('message', { type: 'danger', message: 'Error loading grading page' });
    res.redirect('/exams');
  }
});

// Teacher: submit manual grades for an attempt
router.post('/exams/attempts/:attemptId/grade', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { attemptId } = req.params;
    const scores = req.body.scores || {};
    const comments = req.body.comments || {};

    // Get attempt and verify teacher owns it
    const attemptQuery = `
      SELECT a.*, ea.assignment_id, ea.exam_id, e.exam_title, t.user_id as teacher_user_id
      FROM Attempts a
      JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
      JOIN Exams e ON ea.exam_id = e.exam_id
      JOIN teachers t ON e.teachers_id = t.id
      WHERE a.attempt_id = ${attemptId}
    `;
    const attemptRes = await executeQuery(attemptQuery);
    if (!attemptRes || attemptRes.length === 0) {
      req.flash('message', { type: 'danger', message: 'Attempt not found' });
      return res.redirect('/exams');
    }
    const attempt = attemptRes[0];
    if (attempt.teacher_user_id !== req.user.id) {
      req.flash('message', { type: 'danger', message: 'You do not have permission to grade this attempt' });
      return res.redirect('/exams');
    }

    // Update each response
    let manualTotal = 0;
    for (const responseId in scores) {
      const rawScore = parseFloat(scores[responseId]);
      const scoreVal = isNaN(rawScore) ? 0 : rawScore;
      manualTotal += scoreVal;
      const comment = (comments[responseId] || '').replace(/'/g, "''");

      await executeQuery(`UPDATE Responses SET score_awarded = ${scoreVal}, grader_comment = N'${comment}' WHERE response_id = ${responseId}`);
    }

  // Update attempt manual_score, compute and store total_score and set status to graded
  // total_score is now a regular column, so update it explicitly using the stored auto_score
  await executeQuery(`UPDATE Attempts SET manual_score = ${manualTotal}, total_score = auto_score + ${manualTotal}, status = 'graded' WHERE attempt_id = ${attemptId}`);

    req.flash('message', { type: 'success', message: 'Grades saved successfully' });
    res.redirect(`/exams/assignments/${attempt.assignment_id}/scores`);
  } catch (error) {
    console.error('Error saving manual grades:', error);
    req.flash('message', { type: 'danger', message: 'Error saving grades' });
    res.redirect('/exams');
  }
});

// Delete exam assignment
router.delete('/exams/assignments/:assignmentId', checkAuthenticated, authenticateRole(['teacher']), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    // Verify assignment exists and belongs to teacher
    const verifyQuery = `
      SELECT ea.*, t.user_id as teacher_user_id 
      FROM ExamAssignments ea
      JOIN Exams e ON ea.exam_id = e.exam_id
      JOIN teachers t ON e.teachers_id = t.id
      WHERE ea.assignment_id = ${assignmentId}
    `;
    const assignment = await executeQuery(verifyQuery);

    if (!assignment || assignment.length === 0 || assignment[0].teacher_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    // Delete assignment and all related attempts
    await executeQuery(`
      DELETE ea FROM ExamAssignments ea
      LEFT JOIN Attempts a ON ea.assignment_id = a.assignment_id
      WHERE ea.assignment_id = ${assignmentId}
    `);

    res.json({ success: true, message: 'Assignment removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error removing assignment' });
  }
});

// Start exam attempt
router.post('/:assignmentId/start', checkAuthenticated, authenticateRole(['student']), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    // Get assignment and exam details
    const assignmentQuery = `
      SELECT ea.*, e.shuffle_questions, e.shuffle_options 
      FROM ExamAssignments ea
      JOIN Exams e ON ea.exam_id = e.exam_id
      WHERE ea.assignment_id = ${assignmentId}
    `;
    const assignment = await executeQuery(assignmentQuery);
    
    if (!assignment || assignment.length === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    // Get student ID
    const studentQuery = `
      SELECT id FROM students WHERE user_id = ${req.user.id}
    `;
    const student = await executeQuery(studentQuery);

    if (!student || student.length === 0) {
      return res.status(403).json({ message: "Student not found" });
    }

    // Check attempt count
    const attemptCountQuery = `
      SELECT COUNT(*) as attempt_count, ea.max_attempts
      FROM Attempts a
      JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
      WHERE a.assignment_id = ${assignmentId} 
      AND a.student_id = ${student[0].id}
      GROUP BY ea.max_attempts`;
    
    const attemptCount = await executeQuery(attemptCountQuery);
    
    if (attemptCount.length > 0 && attemptCount[0].attempt_count >= attemptCount[0].max_attempts) {
      return res.status(403).json({ message: "Maximum attempts reached for this exam" });
    }

    // Create attempt
    const attemptQuery = `
      INSERT INTO Attempts (
        assignment_id, 
        student_id,
        attempt_no, 
        started_at,
        submitted_at,
        auto_score,
        manual_score,
        status
      )
      OUTPUT INSERTED.attempt_id
      VALUES (
        ${assignmentId},
        ${student[0].id},
        (SELECT ISNULL(MAX(attempt_no), 0) + 1 
         FROM Attempts 
         WHERE assignment_id = ${assignmentId}
         AND student_id = ${student[0].id}), 
        GETDATE(),
        NULL,
        0,
        0,
        'in_progress')
    `;
    const attempt = await executeQuery(attemptQuery);
    const attemptId = attempt[0].attempt_id;

    // Get questions
    let questionsQuery = `
      SELECT q.*, qt.type_name, qt.type_code
      FROM Questions q
      JOIN QuestionTypes qt ON q.type_id = qt.type_id
      WHERE q.exam_id = ${assignment[0].exam_id}
    `;

    const questions = await executeQuery(questionsQuery);

    // Shuffle questions if enabled
    if (assignment[0].shuffle_questions) {
      questions.sort(() => Math.random() - 0.5);
    }

    // For each MCQ question, create shuffled options
    for (const question of questions) {
      if (question.type_code === 'MCQ') {
        const optionsQuery = `
          SELECT * FROM MCQOptions WHERE question_id = ${question.question_id}
        `;
        let options = await executeQuery(optionsQuery);

        // Shuffle options if enabled
        if (assignment[0].shuffle_options) {
          options.sort(() => Math.random() - 0.5);
        }

        // Create option instances with shuffled order
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          await executeQuery(`
            INSERT INTO OptionInstances (
              attempt_id, 
              question_id, 
              option_id, 
              display_order, 
              display_label, 
              option_text_snapshot, 
              is_correct_snapshot
            )
            VALUES (
              ${attemptId},
              ${question.question_id},
              ${option.option_id},
              ${i + 1},
              '${String.fromCharCode(65 + i)}',
              '${option.option_text}',
              ${option.is_correct}
            )
          `);
        }
      }
    }

    res.json({ 
      attemptId: attemptId,
      questions: questions.map(q => ({
        question_id: q.question_id,
        body_text: q.body_text,
        type: q.type_name,
        points: q.points
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error starting exam" });
  }


});





// Submit exam attempt
const examResponseMediaStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/response_media';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const uploadExamResponse = multer({ storage: examResponseMediaStorage });

// Process an exam submission
router.post('/exams/submit/:attemptId', checkAuthenticated, authenticateRole(['student']), uploadExamResponse.array('files'), async (req, res) => {
    try {
        const attemptId = req.params.attemptId;
        const responses = JSON.parse(req.body.responses);
        const isAutoSubmit = req.body.isAutoSubmit === 'true';

        // Get attempt details
        const attemptQuery = `
            SELECT a.*, ea.exam_id 
            FROM Attempts a
            INNER JOIN ExamAssignments ea ON a.assignment_id = ea.assignment_id
            WHERE a.attempt_id = ${attemptId}`;
        const [attempt] = await executeQuery(attemptQuery);

        if (!attempt) {
            return res.status(404).json({ success: false, message: "Attempt not found" });
        }

        // Get questions for this exam
        const questionsQuery = `
            SELECT q.*, qt.type_code 
            FROM Questions q
            INNER JOIN QuestionTypes qt ON q.type_id = qt.type_id
            WHERE q.exam_id = ${attempt.exam_id}`;
        const questions = await executeQuery(questionsQuery);

        let totalScore = 0;
        let hasEssayQuestion = false;

        // Process each response
        for (const questionId in responses) {
            const question = questions.find(q => q.question_id === parseInt(questionId));
            const response = responses[questionId];

            if (question.type_code === 'MCQ') {
                // For MCQ questions, get correct answer and check
                const optionsQuery = `SELECT * FROM MCQOptions WHERE question_id = ${question.question_id}`;
                const options = await executeQuery(optionsQuery);
                const correctOption = options.find(opt => opt.is_correct);
                const isCorrect = response.selectedOptionId === correctOption.option_id;

                // Create option instance
                const optionInstance = await executeQuery(`
                    INSERT INTO OptionInstances (attempt_id, question_id, option_id, display_order, display_label, option_text_snapshot, is_correct_snapshot)
                    OUTPUT INSERTED.option_instance_id
                    VALUES (${attemptId}, ${question.question_id}, ${response.selectedOptionId}, 1, 'A', 
                    N'${options.find(opt => opt.option_id === response.selectedOptionId).option_text}', 
                    ${isCorrect ? 1 : 0})`);

                // Record response with score
                const score = isCorrect ? question.points : 0;
                totalScore += score;

                await executeQuery(`
                    INSERT INTO Responses (attempt_id, question_id, chosen_option_instance_id, score_awarded, answered_at)
                    VALUES (${attemptId}, ${question.question_id}, ${optionInstance[0].option_instance_id}, ${score}, GETDATE())`);

            } else if (question.type_code === 'ESSAY') {
                hasEssayQuestion = true;
                // For essay questions, store response text and any uploaded files
                // Create response without score (will be graded manually)
        const safeEssayText = (response.text || '').replace(/'/g, "''");
        const responseResult = await executeQuery(`
          INSERT INTO Responses (attempt_id, question_id, essay_text, answered_at)
          VALUES (${attemptId}, ${question.question_id}, N'${safeEssayText}', GETDATE())`);

                // Handle file uploads if any
                if (req.files && req.files.length > 0) {
                    const responseFiles = req.files.filter(f => f.fieldname === `files_${questionId}`);
          for (const file of responseFiles) {
            // Store original file name and the saved file path/url
            await executeQuery(`
              INSERT INTO ResponseMedia (response_id, file_name, file_url)
              VALUES (${responseResult[0].response_id}, N'${file.originalname.replace(/'/g, "''")}', '${file.path.replace(/'/g, "''")}')`);
          }
                }
            }
        }

        // Update attempt status and score
        const status = hasEssayQuestion ? 'needs_grading' : 'graded';
        await executeQuery(`
            UPDATE Attempts 
            SET submitted_at = GETDATE(),
                auto_score = ${totalScore},
                status = '${status}'
            WHERE attempt_id = ${attemptId}`);

        res.json({
            success: true,
            message: hasEssayQuestion ? 
                "Exam submitted successfully. Essay questions will be graded by your teacher." :
                "Exam submitted and graded successfully.",
            score: hasEssayQuestion ? null : totalScore
        });

    } catch (error) {
        console.error('Error submitting exam:', error);
        res.status(500).json({
            success: false,
            message: "Error submitting exam"
        });
    }
});




// New route to start taking an exam
router.get('/exams/:assignmentId/take', checkAuthenticated, authenticateRole(['student']), async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        // Get student ID
        const studentQuery = `SELECT id FROM students WHERE user_id = ${req.user.id}`;
        const student = await executeQuery(studentQuery);
        
        if (!student || student.length === 0) {
            console.log('Debug: Student not found for user_id:', req.user.id);
            req.flash('message', { type: 'danger', message: 'Student not found' });
            return res.redirect('/exams');
        }

        // Check if exam is available and student can take it
        const examQuery = `
            SELECT ea.*, e.*, t.user_id as teacher_user_id,
                   (SELECT COUNT(*) FROM Attempts 
                    WHERE assignment_id = ea.assignment_id 
                    AND student_id = ${student[0].id}) as attempt_count
            FROM ExamAssignments ea
            JOIN Exams e ON ea.exam_id = e.exam_id
            JOIN teachers t ON e.teachers_id = t.id
            JOIN enrollments en ON ea.classes_id = en.class_id
            WHERE ea.assignment_id = ${assignmentId}
            AND en.student_id = ${student[0].id}
        `;
        
        const exam = await executeQuery(examQuery);
        
        console.log('Debug: Exam query result:', JSON.stringify(exam, null, 2));
        
        if (!exam || exam.length === 0) {
            console.log('Debug: Exam not found for assignmentId:', assignmentId);
            console.log('Debug: SQL Query:', examQuery);
            req.flash('message', { type: 'danger', message: 'Exam not found' });
            return res.redirect('/exams');
        }

        // Check if exam is within time window
        const now = new Date();
        const openAt = new Date(exam[0].open_at);
        const closeAt = new Date(exam[0].close_at);
        
        console.log('Debug: Time check:', {
            now: now.toISOString(),
            openAt: openAt.toISOString(),
            closeAt: closeAt.toISOString()
        });
        
        if (now < openAt) {
            console.log('Debug: Exam not yet open');
            req.flash('message', { type: 'danger', message: 'Exam is not yet open' });
            return res.redirect('/exams');
        }
        
        if (now > closeAt) {
            console.log('Debug: Exam has closed');
            req.flash('message', { type: 'danger', message: 'Exam has closed' });
            return res.redirect('/exams');
        }
        
        console.log('Debug: Time check passed');

        // Check attempt limits
        console.log('Debug: Attempt check:', {
            max_attempts: exam[0].max_attempts,
            attempt_count: exam[0].attempt_count
        });
        
        if (exam[0].max_attempts && exam[0].attempt_count >= exam[0].max_attempts) {
            console.log('Debug: Maximum attempts reached');
            req.flash('message', { type: 'danger', message: 'Maximum attempts reached' });
            return res.redirect('/exams');
        }
        
        console.log('Debug: Attempt check passed');

        // Check for existing in-progress attempt
        const inProgressQuery = `
            SELECT attempt_id, started_at, DATEADD(minute, ${exam[0].duration_min}, started_at) as end_time
            FROM Attempts 
            WHERE assignment_id = ${assignmentId}
            AND student_id = ${student[0].id}
            AND status = 'in_progress'
        `;
        
        const inProgress = await executeQuery(inProgressQuery);
        let attemptId;
        
        if (inProgress && inProgress.length > 0) {
            // Resume existing attempt
            attemptId = inProgress[0].attempt_id;
            
            // Calculate remaining time
            const endTime = new Date(inProgress[0].end_time);
            const remainingTime = Math.max(0, Math.floor((endTime - now) / 1000));
            
            if (remainingTime <= 0) {
                // Auto-submit if time has expired
                await executeQuery(`
                    UPDATE Attempts
                    SET status = 'submitted',
                        submitted_at = GETDATE()
                    WHERE attempt_id = ${attemptId}
                `);
                
                req.flash('message', { type: 'warning', message: 'Your attempt has expired and been automatically submitted' });
                return res.redirect('/exams');
            }
            
            exam[0].remaining_time = remainingTime;
        } else {
            // Create new attempt
            const newAttemptQuery = `
                INSERT INTO Attempts (
                    assignment_id,
                    student_id,
                    attempt_no,
                    started_at,
                    status
                )
                OUTPUT INSERTED.attempt_id
                VALUES (
                    ${assignmentId},
                    ${student[0].id},
                    ${exam[0].attempt_count + 1},
                    GETDATE(),
                    'in_progress'
                )
            `;
            
            const newAttempt = await executeQuery(newAttemptQuery);
            attemptId = newAttempt[0].attempt_id;
            exam[0].remaining_time = exam[0].duration_min * 60; // Convert to seconds
        }

        // Get questions
        const questionsQuery = `
            SELECT q.*, qt.type_code, qt.type_name,
                   (SELECT JSON_QUERY((
                     SELECT mo.option_id, mo.option_text,
                            oi.option_instance_id, oi.display_label, oi.option_text_snapshot, oi.is_correct_snapshot
                     FROM MCQOptions mo 
                     LEFT JOIN OptionInstances oi ON mo.option_id = oi.option_id
                     WHERE mo.question_id = q.question_id 
                     FOR JSON PATH
                   ))) as options,
                   (SELECT JSON_QUERY((
                     SELECT qm.* 
                     FROM QuestionMedia qm 
                     WHERE qm.question_id = q.question_id 
                     FOR JSON PATH
                   ))) as media
            FROM Questions q
            JOIN QuestionTypes qt ON q.type_id = qt.type_id
            WHERE q.exam_id = ${exam[0].exam_id}
            ORDER BY ${exam[0].shuffle_questions ? 'NEWID()' : 'q.created_at'}
        `;
        
        const questions = await executeQuery(questionsQuery);
        
        console.log('Debug: SQL Query:', questionsQuery);
        console.log('Debug: Raw questions:', JSON.stringify(questions, null, 2));

        // Parse JSON strings from SQL
        // Process each question
        questions.forEach(q => {
            try {
                console.log('Debug: Processing Question ID:', q.question_id, 'Type:', q.type_code);
                console.log('Debug: Raw options:', q.options);
                console.log('Debug: Raw media:', q.media);

                // Parse options and media
                try {
                    q.options = q.options ? JSON.parse(q.options) : [];
                } catch (parseError) {
                    console.error('Error parsing options for question', q.question_id, ':', parseError);
                    console.error('Raw options string:', q.options);
                    q.options = [];
                }

                try {
                    q.media = q.media ? JSON.parse(q.media) : [];
                } catch (parseError) {
                    console.error('Error parsing media for question', q.question_id, ':', parseError);
                    console.error('Raw media string:', q.media);
                    q.media = [];
                }

                // Debug output after parsing
                if (q.type_code === 'MCQ') {
                    console.log('Debug: Processed MCQ options for question', q.question_id, ':');
                    console.log(JSON.stringify(q.options, null, 2));
                    
                    // Verify required fields
                    q.options.forEach((opt, idx) => {
                        if (!opt.option_text && !opt.option_text_snapshot) {
                            console.warn(`Warning: Option ${idx} for question ${q.question_id} is missing text`);
                        }
                        if (!opt.display_label) {
                            console.warn(`Warning: Option ${idx} for question ${q.question_id} is missing display_label`);
                        }
                    });
                }

                // Shuffle options if enabled
                if (exam[0].shuffle_options && Array.isArray(q.options)) {
                    q.options.sort(() => Math.random() - 0.5);
                }
            } catch (error) {
                console.error('Error processing question', q.question_id, ':', error);
                q.options = [];
                q.media = [];
            }
        });
        
        console.log('Debug: Questions after parsing:', JSON.stringify(questions, null, 2));

        // Get any existing responses
        const responsesQuery = `
            SELECT r.*, 
                   rm.file_name, rm.file_url,
                   oi.option_id, oi.display_label
            FROM Responses r
            LEFT JOIN ResponseMedia rm ON r.response_id = rm.response_id
            LEFT JOIN OptionInstances oi ON r.chosen_option_instance_id = oi.option_instance_id
            WHERE r.attempt_id = ${attemptId}
        `;
        
        const responses = await executeQuery(responsesQuery);

        // Group responses by question
        const responseMap = {};
        responses.forEach(r => {
            if (!responseMap[r.question_id]) {
                responseMap[r.question_id] = {
                    essay_text: r.essay_text,
                    chosen_options: [],
                    files: []
                };
            }
            
            if (r.option_id) {
                responseMap[r.question_id].chosen_options.push({
                    option_id: r.option_id,
                    display_label: r.display_label
                });
            }
            
            if (r.file_url) {
                responseMap[r.question_id].files.push({
                    name: r.file_name,
                    url: r.file_url
                });
            }
        });

        // Final debug log before rendering
        console.log('Debug: Questions being sent to template:', 
            questions.map(q => ({
                id: q.question_id,
                type: q.type_code,
                optionsCount: q.options ? q.options.length : 0,
                hasOptions: Array.isArray(q.options) && q.options.length > 0
            }))
        );

        res.render('exams/examTake', {
            user: req.user,
            exam: exam[0],
            questions: questions,
            attemptId: attemptId,
            responses: responseMap,
            duration: Math.floor(exam[0].remaining_time / 60)
        });
    } catch (error) {
        console.error(error);
        req.flash('message', { type: 'danger', message: 'Error starting exam' });
        res.redirect('/exams');
        console.log('Redirected to /exams due to error starting exam:', error);
    }
});


module.exports = router;
