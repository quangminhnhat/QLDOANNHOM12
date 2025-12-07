const executeQuery = require("./executeQuery");

async function deleteMCQQuestion(questionId) {
    try {
        // Delete all associated media files
        await executeQuery(`DELETE FROM QuestionMedia WHERE question_id = ${questionId}`);
        
        // Delete all associated MCQ options
        await executeQuery(`DELETE FROM MCQOptions WHERE question_id = ${questionId}`);
        
        // Delete the question itself
        await executeQuery(`DELETE FROM Questions WHERE question_id = ${questionId} AND type_id = 1`);

        return {
            success: true,
            message: "MCQ Question deleted successfully"
        };
    } catch (error) {
        console.error('Error in deleteMCQQuestion:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function editMCQQuestion(questionId, questionData, files) {
    try {
        // Update the base question
        const updateQuestionQuery = `
            UPDATE Questions 
            SET points = ${questionData.points},
                body_text = '${questionData.body_text}',
                difficulty = ${questionData.difficulty || 'NULL'},
                updated_at = GETDATE()
            WHERE question_id = ${questionId} AND type_id = 1
        `;
        await executeQuery(updateQuestionQuery);

        // Handle media files
        if (files && files.length > 0) {
            // Delete existing media first
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

        // Handle MCQ options
        if (questionData.options) {
            // First delete responses that reference this question's option instances
            await executeQuery(`
                DELETE r
                FROM Responses r
                INNER JOIN OptionInstances oi ON r.chosen_option_instance_id = oi.option_instance_id
                INNER JOIN MCQOptions mo ON oi.option_id = mo.option_id
                WHERE mo.question_id = ${questionId}
            `);

            // Then delete response multi-select entries
            await executeQuery(`
                DELETE rms
                FROM ResponseMultiSelect rms
                INNER JOIN OptionInstances oi ON rms.option_instance_id = oi.option_instance_id
                INNER JOIN MCQOptions mo ON oi.option_id = mo.option_id
                WHERE mo.question_id = ${questionId}
            `);

            // Now we can safely delete option instances
            await executeQuery(`
                DELETE oi
                FROM OptionInstances oi
                INNER JOIN MCQOptions mo ON oi.option_id = mo.option_id
                WHERE mo.question_id = ${questionId}
            `);

            // Finally delete the existing options
            await executeQuery(`DELETE FROM MCQOptions WHERE question_id = ${questionId}`);
            
            // Add updated options
            const options = JSON.parse(questionData.options);
            for (const option of options) {
                const optionQuery = `
                    INSERT INTO MCQOptions (question_id, option_text, is_correct, explanation)
                    VALUES (${questionId}, '${option.text}', ${option.isCorrect ? 1 : 0}, ${option.explanation ? `'${option.explanation}'` : 'NULL'})
                `;
                await executeQuery(optionQuery);
            }
        }

        return {
            success: true,
            questionId: questionId,
            message: "MCQ Question updated successfully"
        };
    } catch (error) {
        console.error('Error in editMCQQuestion:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function createMCQQuestion(examId, questionData, files) {
    try {
        // Insert the base question
        const questionQuery = `
            INSERT INTO Questions (exam_id, type_id, points, body_text, difficulty, created_at)
            OUTPUT INSERTED.question_id
            VALUES (${examId === 'bank' ? 'NULL' : examId}, 1, ${questionData.points}, N'${questionData.body_text}', ${questionData.difficulty || 'NULL'}, GETDATE())
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

        // Handle MCQ options
        if (questionData.options) {
            const options = JSON.parse(questionData.options);
            for (const option of options) {
                const optionQuery = `
                    INSERT INTO MCQOptions (question_id, option_text, is_correct, explanation)
                    VALUES (${questionId}, '${option.text}', ${option.isCorrect ? 1 : 0}, ${option.explanation ? `'${option.explanation}'` : 'NULL'})
                `;
                await executeQuery(optionQuery);
            }
        }

        return {
            success: true,
            questionId: questionId,
            message: examId === 'bank' ? "MCQ Question added to bank successfully" : "MCQ Question added to exam successfully"
        };
    } catch (error) {
        console.error('Error in createMCQQuestion:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    createMCQQuestion,
    editMCQQuestion,
    deleteMCQQuestion
};