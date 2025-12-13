const express = require('express');
const router = express.Router();
const executeQuery = require('../middleware/executeQuery');
const { authenticateRole } = require("../middleware/roleAuth");

// List all furniture
router.get('/list',authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const query = 'SELECT * FROM furniture ORDER BY id DESC';
        const result = await executeQuery(query);
        res.render('furniture/list', {
            user: req.user,
            furniture: result,
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error fetching furniture list:', error);
        res.status(500).render('error', { user: req.user, message: 'Error fetching furniture list' });
    }
});

// Get furniture by ID (API endpoint)
router.get('/get/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `SELECT * FROM furniture WHERE id = ${id}`;
        const result = await executeQuery(query);
        
        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Furniture not found' });
        }
        
        res.json({ success: true, data: result[0] });
    } catch (error) {
        console.error('Error fetching furniture:', error);
        res.status(500).json({ success: false, message: 'Error fetching furniture' });
    }
});

// Add furniture page
router.get('/add', authenticateRole(["admin", "employee"]), (req, res) => {
    res.render('furniture/add', {
        user: req.user,
        message: req.query.message || '',
        messageType: req.query.messageType || ''
    });
});

// Create furniture (POST)
router.post('/add', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { name, description } = req.body;

        // Validation
        if (!name || name.trim() === '') {
            return res.redirect('/furniture/add?message=Vui lòng nhập tên đồ dùng&messageType=error');
        }

        // Check if furniture name already exists
        const checkQuery = `SELECT id FROM furniture WHERE name = N'${name.replace(/'/g, "''")}'`;
        const checkResult = await executeQuery(checkQuery);
        
        if (checkResult.length > 0) {
            return res.redirect('/furniture/add?message=Tên đồ dùng đã tồn tại&messageType=error');
        }

        const query = `
            INSERT INTO furniture (name, description, created_at, updated_at)
            VALUES (N'${name.replace(/'/g, "''")}', N'${(description || '').replace(/'/g, "''")}', GETDATE(), GETDATE())
        `;
        
        await executeQuery(query);
        res.redirect('/furniture/list?message=Thêm đồ dùng thành công&messageType=success');
    } catch (error) {
        console.error('Error adding furniture:', error);
        res.redirect('/furniture/add?message=Lỗi khi thêm đồ dùng&messageType=error');
    }
});

// Edit furniture page
router.get('/edit/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;
        const query = `SELECT * FROM furniture WHERE id = ${id}`;
        const result = await executeQuery(query);

        if (result.length === 0) {
            return res.status(404).render('error', { user: req.user, message: 'Đồ dùng không tìm thấy' });
        }

        res.render('furniture/edit', {
            user: req.user,
            furniture: result[0],
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error fetching furniture for edit:', error);
        res.status(500).render('error', { user: req.user, message: 'Error fetching furniture' });
    }
});

// Update furniture (POST)
router.post('/edit/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        // Validation
        if (!name || name.trim() === '') {
            return res.redirect(`/furniture/edit/${id}?message=Vui lòng nhập tên đồ dùng&messageType=error`);
        }

        // Check if furniture name already exists (excluding current furniture)
        const checkQuery = `SELECT id FROM furniture WHERE name = N'${name.replace(/'/g, "''")}' AND id != ${id}`;
        const checkResult = await executeQuery(checkQuery);
        
        if (checkResult.length > 0) {
            return res.redirect(`/furniture/edit/${id}?message=Tên đồ dùng đã tồn tại&messageType=error`);
        }

        const query = `
            UPDATE furniture
            SET name = N'${name.replace(/'/g, "''")}',
                description = N'${(description || '').replace(/'/g, "''")}',
                updated_at = GETDATE()
            WHERE id = ${id}
        `;
        
        await executeQuery(query);
        res.redirect('/furniture/list?message=Cập nhật đồ dùng thành công&messageType=success');
    } catch (error) {
        console.error('Error updating furniture:', error);
        res.redirect(`/furniture/edit/${req.params.id}?message=Lỗi khi cập nhật đồ dùng&messageType=error`);
    }
});

// Delete furniture
router.post('/delete/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if furniture is in use in any room
        const checkQuery = `SELECT COUNT(*) as count FROM room_furniture WHERE furniture_id = ${id}`;
        const checkResult = await executeQuery(checkQuery);
        
        if (checkResult[0].count > 0) {
            return res.json({ 
                success: false, 
                message: 'Không thể xóa đồ dùng này vì nó đang được sử dụng trong các phòng' 
            });
        }

        const query = `DELETE FROM furniture WHERE id = ${id}`;
        await executeQuery(query);
        
        res.json({ success: true, message: 'Xóa đồ dùng thành công' });
    } catch (error) {
        console.error('Error deleting furniture:', error);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa đồ dùng' });
    }
});

module.exports = router;
