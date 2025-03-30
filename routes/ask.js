const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const { userMessage } = req.body; 

  
  if (!userMessage || userMessage.trim() === '') {
    return res.status(400).json({ error: 'userMessage is required' });
  }

  try {
    //const replyFromAi = await getAiResponse(userMessage);
    const replyFromAi = "Hey there, I'm your AI sexual health doctor.";
    return res.json({ aiResponse: replyFromAi });
  } catch (error) {
    console.error('There was an error in the /ask route.', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
