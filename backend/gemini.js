
import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
const apiKey = process.env.GEMINI_API_KEY;


if (!apiKey) {
  console.error("❌ GEMINI_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}


const app = express();
const port = 3001; // React dev server(3000/5173 등)와 겹치지 않게

// 미들웨어
app.use(cors());
app.use(express.json());

// 2. Gemini 클라이언트 생성
const genAI = new GoogleGenerativeAI(apiKey);

// 3. 사용할 모델 이름 (텍스트/대화용)
const MODEL_NAME = "gemini-2.5-flash"; // 필요하면 1.5-pro 등으로 변경 가능

const model = genAI.getGenerativeModel({ model: MODEL_NAME });

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message 필드에 문자열을 보내줘야 합니다.' });
    }

    const result = await model.generateContent(message);
    const response = result.response;
    const text = response.text();

    return res.json({ text });
  } catch (err) {
    console.error('❌ Gemini 호출 중 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Gemini 서버가 http://localhost:${port} 에서 실행 중`);
});