const express = require('express');
const router = express.Router();
const executeQuery = require('../middleware/executeQuery');
const { authenticateRole } = require("../middleware/roleAuth");
// List all rooms
router.get('/list', async (req, res) => {
    try {
        // Automatically update room availability based on rental contracts
        const updateStatusQuery = `
            -- Step 1: Mark any active contracts with a past end date as 'completed'
            UPDATE rental_contracts
            SET status = 'completed', 
                updated_at = GETDATE()
            WHERE end_date < CAST(GETDATE() AS DATE) AND status = 'active';

            -- Step 2: Set all rooms to available by default
            UPDATE rooms SET is_available = 1;

            -- Step 3: Mark rooms as unavailable only if they have a currently ongoing contract.
            -- An ongoing contract is 'active' and the current date is between its start and end dates.
            UPDATE rooms
            SET is_available = 0, 
                updated_at = GETDATE()
            WHERE id IN (
                SELECT DISTINCT room_id FROM rental_contracts 
                WHERE status = 'active' AND CAST(GETDATE() AS DATE) BETWEEN start_date AND end_date
            );
        `;
        await executeQuery(updateStatusQuery);

        const query = `
            SELECT 
                r.*,
                COUNT(rf.furniture_id) as furniture_count
            FROM rooms r
            LEFT JOIN room_furniture rf ON r.id = rf.room_id
            GROUP BY r.id, r.room_number, r.room_type, r.size_sqm, r.description, 
                     r.rent_price, r.is_available, r.created_at, r.updated_at
            ORDER BY r.id DESC
        `;
        const result = await executeQuery(query);
        res.render('rooms/list', {
            user: req.user,
            rooms: result,
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error fetching rooms list:', error);
        res.status(500).render('error', { user: req.user,message: 'Error fetching rooms list' });
    }
});

// Get room by ID (API endpoint)
router.get('/get/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT 
                r.*,
                STRING_AGG(f.name, ', ') as furniture_list
            FROM rooms r
            LEFT JOIN room_furniture rf ON r.id = rf.room_id
            LEFT JOIN furniture f ON rf.furniture_id = f.id
            WHERE r.id = ${id}
            GROUP BY r.id, r.room_number, r.room_type, r.size_sqm, r.description, 
                     r.rent_price, r.is_available, r.created_at, r.updated_at
        `;
        const result = await executeQuery(query);
        
        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }
        
        res.json({ success: true, data: result[0] });
    } catch (error) {
        console.error('Error fetching room:', error);
        res.status(500).json({ success: false, message: 'Error fetching room' });
    }
});

// View room details page
router.get('/view/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get room details
        const roomQuery = `SELECT * FROM rooms WHERE id = ${id}`;
        const roomResult = await executeQuery(roomQuery);

        if (roomResult.length === 0) {
            return res.status(404).render('error', { user: req.user,message: 'Phòng không tìm thấy' });
        }

        // Get furniture in this room
        const furnitureQuery = `
            SELECT 
                f.id,
                f.name,
                f.description,
                rf.quantity
            FROM room_furniture rf
            JOIN furniture f ON rf.furniture_id = f.id
            WHERE rf.room_id = ${id}
            ORDER BY f.name
        `;
        const furnitureResult = await executeQuery(furnitureQuery);

        res.render('rooms/view', {
            user: req.user,
            room: roomResult[0],
            furnitureList: furnitureResult
        });
    } catch (error) {
        console.error('Error fetching room details:', error);
        res.status(500).render('error', { user: req.user,message: 'Error fetching room details' });
    }
});

// Add room page
router.get('/add', authenticateRole(["admin", "employee"]), (req, res) => {
    res.render('rooms/add', {
        user: req.user,
        message: req.query.message || '',
        messageType: req.query.messageType || ''
    });
});

// Create room (POST)
router.post('/add', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { room_number, room_type, size_sqm, description, rent_price, is_available } = req.body;

        // Validation
        if (!room_number || room_number.trim() === '') {
            return res.redirect('/rooms/add?message=Vui lòng nhập số phòng&messageType=error');
        }

        if (!room_type || !['phòng tự học', 'phòng lab'].includes(room_type)) {
            return res.redirect('/rooms/add?message=Loại phòng không hợp lệ&messageType=error');
        }

        if (!rent_price || isNaN(rent_price) || rent_price <= 0) {
            return res.redirect('/rooms/add?message=Giá thuê phòng phải lớn hơn 0&messageType=error');
        }

        // Check if room number already exists
        const checkQuery = `SELECT id FROM rooms WHERE room_number = N'${room_number.replace(/'/g, "''")}'`;
        const checkResult = await executeQuery(checkQuery);
        
        if (checkResult.length > 0) {
            return res.redirect('/rooms/add?message=Số phòng đã tồn tại&messageType=error');
        }

        const query = `
            INSERT INTO rooms (room_number, room_type, size_sqm, description, rent_price, is_available, created_at, updated_at)
            VALUES (
                N'${room_number.replace(/'/g, "''")}',
                N'${room_type}',
                ${size_sqm && !isNaN(size_sqm) ? parseFloat(size_sqm) : 'NULL'},
                N'${(description || '').replace(/'/g, "''")}',
                ${parseFloat(rent_price)},
                ${is_available ? 1 : 0},
                GETDATE(),
                GETDATE()
            )
        `;
        
        await executeQuery(query);
        res.redirect('/rooms/list?message=Thêm phòng thành công&messageType=success');
    } catch (error) {
        console.error('Error adding room:', error);
        res.redirect('/rooms/add?message=Lỗi khi thêm phòng&messageType=error');
    }
});

// Edit room page
router.get('/edit/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;
        const query = `SELECT * FROM rooms WHERE id = ${id}`;
        const result = await executeQuery(query);

        if (result.length === 0) {
            return res.status(404).render('error', { user: req.user,message: 'Phòng không tìm thấy' });
        }

        res.render('rooms/edit', {
            user: req.user,
            room: result[0],
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error fetching room for edit:', error);
        res.status(500).render('error', { user: req.user,message: 'Error fetching room' });
    }
});

// Update room (POST)
router.post('/edit/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { room_number, room_type, size_sqm, description, rent_price, is_available } = req.body;

        // Validation
        if (!room_number || room_number.trim() === '') {
            return res.redirect(`/rooms/edit/${id}?message=Vui lòng nhập số phòng&messageType=error`);
        }

        if (!room_type || !['phòng tự học', 'phòng lab'].includes(room_type)) {
            return res.redirect(`/rooms/edit/${id}?message=Loại phòng không hợp lệ&messageType=error`);
        }

        if (!rent_price || isNaN(rent_price) || rent_price <= 0) {
            return res.redirect(`/rooms/edit/${id}?message=Giá thuê phòng phải lớn hơn 0&messageType=error`);
        }

        // Check if room number already exists (excluding current room)
        const checkQuery = `SELECT id FROM rooms WHERE room_number = N'${room_number.replace(/'/g, "''")}' AND id != ${id}`;
        const checkResult = await executeQuery(checkQuery);
        
        if (checkResult.length > 0) {
            return res.redirect(`/rooms/edit/${id}?message=Số phòng đã tồn tại&messageType=error`);
        }

        const query = `
            UPDATE rooms
            SET room_number = N'${room_number.replace(/'/g, "''")}',
                room_type = N'${room_type}',
                size_sqm = ${size_sqm && !isNaN(size_sqm) ? parseFloat(size_sqm) : 'NULL'},
                description = N'${(description || '').replace(/'/g, "''")}',
                rent_price = ${parseFloat(rent_price)},
                is_available = ${is_available ? 1 : 0},
                updated_at = GETDATE()
            WHERE id = ${id}
        `;
        
        await executeQuery(query);
        res.redirect('/rooms/list?message=Cập nhật phòng thành công&messageType=success');
    } catch (error) {
        console.error('Error updating room:', error);
        res.redirect(`/rooms/edit/${req.params.id}?message=Lỗi khi cập nhật phòng&messageType=error`);
    }
});

// Delete room
router.post('/delete/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if room has active rental contracts
        const checkQuery = `SELECT COUNT(*) as count FROM rental_contracts WHERE room_id = ${id} AND status = 'active'`;
        const checkResult = await executeQuery(checkQuery);
        
        if (checkResult[0].count > 0) {
            return res.json({ 
                success: false, 
                message: 'Không thể xóa phòng này vì nó có hợp đồng thuê đang hoạt động' 
            });
        }

        // Delete room furniture assignments first
        await executeQuery(`DELETE FROM room_furniture WHERE room_id = ${id}`);
        
        // Delete rental contracts
        await executeQuery(`DELETE FROM rental_contracts WHERE room_id = ${id}`);
        
        // Delete the room
        const query = `DELETE FROM rooms WHERE id = ${id}`;
        await executeQuery(query);
        
        res.json({ success: true, message: 'Xóa phòng thành công' });
    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa phòng' });
    }
});

module.exports = router;
