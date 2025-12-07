//lib import
const express = require("express");
const app = express();
const path = require("path");
const bcrypt = require("bcrypt");
const sql = require("msnodesqlv8");
const passport = require("passport");
const flash = require("express-flash");
const session = require("express-session");
const methodOverride = require("method-override");
const { authenticateRole } = require("../middleware/roleAuth");
const multer = require("multer");
const fs = require("fs");
const connectionString = process.env.CONNECTION_STRING;
const upload = require("../middleware/upload");
const courseImageUpload = require("../middleware/courseImageUpload");
const executeQuery = require("../middleware/executeQuery");
const {
  checkAuthenticated,
  checkNotAuthenticated,
} = require("../middleware/auth");
const validateSchedule = require("../middleware/validateSchedule");

const router = express.Router();

// Add these new routes before the existing POST/PUT/DELETE routes

// Render request list page
router.get(
  "/requests",
  checkAuthenticated,
  authenticateRole(["student", "teacher", "admin"]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      
      let requestQuery = `
        SELECT r.request_id, r.description, r.status, r.created_at,
               rt.type_name, c.class_name, u.username, u.full_name, u.role,
               r.class_id
        FROM Requests r
        JOIN RequestTypes rt ON r.type_id = rt.type_id
        JOIN users u ON r.user_id = u.id
        LEFT JOIN classes c ON r.class_id = c.id
      `;

      let params = {};
      
      // Filter based on role
      if (userRole === 'student') {
        requestQuery += ` WHERE r.user_id = CAST(@userId AS INT)`;
        params.userId = userId;
      } else if (userRole === 'teacher') {
        requestQuery += ` WHERE (r.user_id = CAST(@userId AS INT) OR 
                                (u.role = 'student' AND EXISTS (
                                  SELECT 1 FROM classes cls
                                  JOIN teachers t ON cls.teacher_id = t.id
                                  WHERE t.user_id = CAST(@userId AS INT)
                                  AND cls.id = r.class_id
                                )))`;
        params.userId = userId;
      }
      
      requestQuery += ` ORDER BY r.created_at DESC`;

      const requests = await executeQuery(requestQuery, params);

      res.render("request/requestsindex", {
        user: req.user,
        requests,
        userRole,
        title: "Request List",
      });
    } catch (error) {
      console.error("Error fetching requests:", error);
      res.status(500).render('error', { 
        message: 'Error loading requests'
      });
    }
  }
);

// Render new request form
router.get(
  "/requests/new",
  checkAuthenticated,
  authenticateRole(["student", "teacher"]),
  async (req, res) => {
    try {
      // Get available request types for user role
      const typeQuery = `
        SELECT type_id, type_name 
        FROM RequestTypes 
        WHERE applicable_to = @role
      `;
      
      const requestTypes = await executeQuery(typeQuery, {
        role: req.user.role
      });

      // Get available classes for the user
      const classQuery = req.user.role === 'student' ? 
        `SELECT c.id, c.class_name 
         FROM classes c
         JOIN enrollments e ON c.id = e.class_id
         JOIN students s ON e.student_id = s.id
         WHERE s.user_id = @userId` :
        `SELECT c.id, c.class_name 
         FROM classes c
         JOIN teachers t ON c.teacher_id = t.id
         WHERE t.user_id = @userId`;

      const classes = await executeQuery(classQuery, {
        userId: req.user.id
      });

      res.render("request/requestsnew", {
        user: req.user,
        requestTypes,
        classes,
        title: "New Request",
      });
    } catch (error) {
      console.error("Error loading request form:", error);
      res.status(500).render('error', {
        message: 'Error loading request form'
      });
    }
  }
);

// Render edit request form
router.get(
  "/requests/:requestId/edit",
  checkAuthenticated,
  authenticateRole(["student", "teacher"]),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const userId = req.user.id;

      // Get request details
      const requestQuery = `
        SELECT r.*, rt.type_name, c.class_name
        FROM Requests r
        JOIN RequestTypes rt ON r.type_id = rt.type_id
        LEFT JOIN classes c ON r.class_id = c.id
        WHERE r.request_id = @requestId 
        AND r.user_id = @userId
      `;

      const [request] = await executeQuery(requestQuery, {
        requestId,
        userId
      });

      if (!request) {
        return res.status(404).render('error', {
          message: 'Request not found'
        });
      }

      // Get available classes (same as new request form)
      const classQuery = req.user.role === 'student' ? 
        `SELECT c.id, c.class_name 
         FROM classes c
         JOIN enrollments e ON c.id = e.class_id
         JOIN students s ON e.student_id = s.id
         WHERE s.user_id = @userId` :
        `SELECT c.id, c.class_name 
         FROM classes c
         JOIN teachers t ON c.teacher_id = t.id
         WHERE t.user_id = @userId`;

      const classes = await executeQuery(classQuery, {
        userId
      });

      res.render("request/requestsedit", {
        user: req.user,
        request,
        classes,
        title: "Edit Request",
      });
    } catch (error) {
      console.error("Error loading edit form:", error);
      res.status(500).render('error', {
        message: 'Error loading edit form'
      });
    }
  }
);


// Create a new request

router.post(
  "/requestAdd",
  checkAuthenticated,
  authenticateRole(["student", "teacher"]),
  async (req, res) => {
    const { userId, requestType, details, classId } = req.body;
    const senderRole = req.user.role;

    try {
      // Get request type ID from RequestTypes table
      const typeQuery = `SELECT type_id FROM RequestTypes WHERE type_name = ? AND applicable_to = ?`;
      const typeResult = await executeQuery(typeQuery, [
        requestType,
        senderRole
      ]);

      if (!typeResult || typeResult.length === 0) {
        return res.status(400).json({ error: "Invalid request type for your role" });
      }

      const typeId = typeResult[0].type_id;

      // Insert the request
      const insertQuery = `
        INSERT INTO Requests (user_id, type_id, class_id, description, status)
        VALUES (@userId, @typeId, @classId, @details, 'pending')
      `;

      await executeQuery(insertQuery, {
        userId: userId,
        typeId: typeId,
        classId: classId,
        details: details
      });

      // If it's a class-related request, notify relevant users
      if (classId) {
        const notifyQuery = `
          INSERT INTO notifications (user_id, message, sender_id)
          SELECT 
            CASE 
              WHEN u.role = 'teacher' THEN (SELECT TOP 1 user_id FROM admins)
              ELSE (SELECT TOP 1 t.user_id FROM teachers t 
                    INNER JOIN classes c ON t.id = c.teacher_id 
                    WHERE c.id = @classId)
            END,
            @message,
            @senderId
          FROM users u WHERE u.id = @userId
        `;

        await executeQuery(notifyQuery, {
          classId: classId,
          message: `New ${requestType} request from ${req.user.username}`,
          senderId: userId,
          userId: userId
        });
      }

      res.status(200).json({ message: "Request submitted successfully" });

    } catch (error) {
      console.error("Error submitting request:", error);
      res.status(500).json({ error: "Failed to submit request" });
    }
  }
);

router.delete(
  "/requestDelete/:requestId",
  checkAuthenticated,
  authenticateRole(["student", "teacher", "admin"]),
  async (req, res) => {
    const requestId = req.params.requestId;
    const userId = req.user.id;

    try {
      // First check if request exists and belongs to user
      const checkQuery = `
        SELECT status 
        FROM Requests 
        WHERE request_id = @requestId 
        AND user_id = @userId
      `;

      const request = await executeQuery(checkQuery, {
        requestId: requestId,
        userId: userId
      });

      if (!request || request.length === 0) {
        return res.status(404).json({ 
          error: "Request not found or you don't have permission to delete it" 
        });
      }

      // Only allow deletion of pending requests
      if (request[0].status !== 'pending') {
        return res.status(400).json({
          error: "Only pending requests can be deleted"
        });
      }

      // Delete the request
      const deleteQuery = `
        DELETE FROM Requests 
        WHERE request_id = @requestId 
        AND user_id = @userId 
        AND status = 'pending'
      `;

      await executeQuery(deleteQuery, {
        requestId: requestId,
        userId: userId
      });

      res.status(200).json({ 
        message: "Request deleted successfully" 
      });

    } catch (error) {
      console.error("Error deleting request:", error);
      res.status(500).json({ 
        error: "Failed to delete request" 
      });
    }
  }
);

router.put(
  "/requestEdit/:requestId",
  checkAuthenticated,
  authenticateRole(["student", "teacher"]),
  async (req, res) => {
    const requestId = req.params.requestId;
    const userId = req.user.id;
    const { details, classId } = req.body;

    try {
      // Check if request exists and belongs to user
      const checkQuery = `
        SELECT r.status, r.type_id, rt.type_name, rt.applicable_to
        FROM Requests r
        JOIN RequestTypes rt ON r.type_id = rt.type_id
        WHERE r.request_id = @requestId 
        AND r.user_id = @userId
      `;

      const request = await executeQuery(checkQuery, {
        requestId: requestId,
        userId: userId
      });

      if (!request || request.length === 0) {
        return res.status(404).json({
          error: "Request not found or you don't have permission to edit it"
        });
      }

      // Only allow editing of pending requests
      if (request[0].status !== 'pending') {
        return res.status(400).json({
          error: "Only pending requests can be edited"
        });
      }

      // Update the request
      const updateQuery = `
        UPDATE Requests 
        SET description = @details,
            class_id = @classId,
            updated_at = GETDATE()
        WHERE request_id = @requestId 
        AND user_id = @userId 
        AND status = 'pending'
      `;

      await executeQuery(updateQuery, {
        requestId: requestId,
        userId: userId,
        details: details,
        classId: classId
      });

      // Update notification if class-related request
      if (classId) {
        const notifyQuery = `
          UPDATE notifications
          SET message = @message,
              updated_at = GETDATE()
          WHERE sender_id = @userId
          AND EXISTS (
            SELECT 1 FROM Requests 
            WHERE request_id = @requestId
            AND user_id = @userId
          )
        `;

        await executeQuery(notifyQuery, {
          message: `Updated ${request[0].type_name} request from ${req.user.username}`,
          userId: userId,
          requestId: requestId
        });
      }

      res.status(200).json({
        message: "Request updated successfully"
      });

    } catch (error) {
      console.error("Error updating request:", error);
      res.status(500).json({
        error: "Failed to update request"
      });
    }
  }
);

// Toggle request status (admin only)
router.put(
  "/requestToggleStatus/:requestId",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    const requestId = req.params.requestId;
    const actionUserId = req.user.id;
    const userRole = req.user.role;

    try {
      // Get request details first with permission check
      const checkQuery = `
        SELECT r.*, rt.type_name, rt.applicable_to, u.username, u.role, u.id as requester_id,
               s.id as student_id
        FROM Requests r
        JOIN RequestTypes rt ON r.type_id = rt.type_id
        JOIN users u ON r.user_id = u.id
        LEFT JOIN students s ON s.user_id = u.id
        WHERE r.request_id = @requestId
      `;

      const [request] = await executeQuery(checkQuery, {
        requestId: requestId
      });

      if (!request) {
        return res.status(404).json({
          error: "Request not found"
        });
      }

      // Check permissions
      if (userRole === 'teacher') {
        // Teachers can only approve student requests
        if (request.role !== 'student') {
          return res.status(403).json({
            error: "Teachers can only manage student requests"
          });
        }
        // Check if the teacher is teaching the class related to the request
        if (request.class_id) {
          const teacherCheck = await executeQuery(`
            SELECT 1
            FROM teachers t
            JOIN classes c ON t.id = c.teacher_id
            WHERE t.user_id = @teacherId 
            AND c.id = @classId
          `, {
            teacherId: actionUserId,
            classId: request.class_id
          });

          if (!teacherCheck || teacherCheck.length === 0) {
            return res.status(403).json({
              error: "You can only manage requests from students in your classes"
            });
          }
        } else {
          return res.status(403).json({
            error: "This request is not associated with any class"
          });
        }
        // Teachers can both approve and reject student requests, no additional check needed here
      }

      // Both admin and teacher can toggle between approved and rejected
      const newStatus = request.status === 'approved' ? 'rejected' : 'approved';

      // Update request status
      const updateQuery = `
        UPDATE Requests 
        SET status = @newStatus,
            updated_at = GETDATE()
        WHERE request_id = @requestId
      `;

      await executeQuery(updateQuery, {
        requestId: requestId,
        newStatus: newStatus
      });

      // Notify the request creator
      const notifyQuery = `
        INSERT INTO notifications (user_id, message, sender_id)
        VALUES (@userId, @message, @actionUserId)
      `;

      await executeQuery(notifyQuery, {
        userId: request.user_id,
        message: `Your ${request.type_name} request has been ${newStatus} by ${userRole}`,
        actionUserId: actionUserId
      });

      // If it's a teacher's request and it was approved, notify affected students
      if (request.role === 'teacher' && newStatus === 'approved' && request.class_id) {
        const notifyStudentsQuery = `
          INSERT INTO notifications (user_id, message, sender_id)
          SELECT s.user_id, @message, @actionUserId
          FROM students s
          JOIN enrollments e ON s.id = e.student_id
          WHERE e.class_id = @classId
        `;

        await executeQuery(notifyStudentsQuery, {
          message: `${request.type_name} request from ${request.username} has been approved for your class`,
          actionUserId: actionUserId,
          classId: request.class_id
        });
      }

      res.status(200).json({
        message: `Request ${newStatus} successfully`,
        newStatus: newStatus
      });

    } catch (error) {
      console.error("Error toggling request status:", error);
      res.status(500).json({
        error: "Failed to update request status"
      });
    }
  }
);

module.exports = router;
