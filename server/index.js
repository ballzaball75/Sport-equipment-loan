require('dotenv').config();
const { createApp } = require('./src/app');
const repo = require('./src/repo');

const app = createApp(repo, {
  maxLoanDays: Number(process.env.MAX_LOAN_DAYS) || 7,
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : true,
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Sports Locker API listening on ${port}`));
