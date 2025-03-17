import dotenv from 'dotenv';
import app from './src/app.js';

dotenv.config();

// Start server
const PORT = process.env.PORT || 19834;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
