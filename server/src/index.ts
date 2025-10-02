import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import judgeRouter from './routes/judge.js';
import calculatorRouter from './routes/calculator.js';
import leaderboardRouter from './routes/leaderboard.js';
import adminRouter from './routes/admin.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/judge', judgeRouter);
app.use('/calculator', calculatorRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/admin', adminRouter);

app.use(errorHandler);

const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
