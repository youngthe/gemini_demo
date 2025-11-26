
import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import session from "express-session";
import axios from "axios";
import qs from "qs"

const apiKey = process.env.GEMINI_API_KEY;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

let lastGeminiReply = "";   // 🔹 마지막 Gemini 응답 저장용
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}

const app = express();
const port = 3001; // React dev server(3000/5173 등)와 겹치지 않게

const KAKAO_REDIRECT_URI = "http://localhost:3001/oauth/kakao/callback";

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: "kakao-secret",
    resave: false,
    saveUninitialized: true,
  })
);

// 2. Gemini 클라이언트 생성
const genAI = new GoogleGenerativeAI(apiKey);

// 3. 사용할 모델 이름 (텍스트/대화용)
const MODEL_NAME = "gemini-2.5-flash"; // 필요하면 1.5-pro 등으로 변경 가능

const model = genAI.getGenerativeModel({ model: MODEL_NAME });

app.post('/api/chat', async (req, res) => {
  try {
    let { message } = req.body;
    message = message + "응답할 때 3가지로 정리해주고 그 추천하는 근거도 제시해줘, 150자 이내로 응답해줘 " ;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message 필드에 문자열을 보내줘야 합니다.' });
    }
    
    const result = await model.generateContent(message);
    const response = result.response;
    const text = response.text();

    lastGeminiReply = text;

    return res.json({ text });
  } catch (err) {
    console.error('❌ Gemini 호출 중 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

app.get("/login/kakao", (req, res) => {
  // 예전 토큰 버리기
  req.session.kakaoAccessToken = null;

  const kakaoAuthUrl =
    "https://kauth.kakao.com/oauth/authorize?" +
    `client_id=${KAKAO_REST_API_KEY}&` +
    `redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&` +
    "response_type=code&" +
    "scope=talk_message&" +         // 🔹 꼭 필요
    "prompt=consent";               // 🔹 기존 동의가 있어도 다시 물어보게

  return res.redirect(kakaoAuthUrl);
});


app.get("/oauth/kakao/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenResponse = await axios.post(
      "https://kauth.kakao.com/oauth/token",
      qs.stringify({
        grant_type: "authorization_code",
        client_id: KAKAO_REST_API_KEY,
        redirect_uri: KAKAO_REDIRECT_URI,
        code,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    req.session.kakaoAccessToken = accessToken;

     const messageText =
      lastGeminiReply && lastGeminiReply.trim().length > 0
        ? lastGeminiReply
        : "안녕하세요! (아직 Gemini 응답이 없습니다.)";


    // 🔹 여기서 "안녕하세요" 전송
    await axios.post(
      "https://kapi.kakao.com/v2/api/talk/memo/default/send",
      qs.stringify({
        template_object: JSON.stringify({
          object_type: "text",
          text: messageText,
          link: {
            web_url: "https://example.com",
            mobile_web_url: "https://example.com",
          },
        }),
      }),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return res.send(`
      <h2>카카오 로그인 + 메시지 전송 성공!</h2>
      <a href="http://localhost:5173">메인으로 돌아가기</a>
    `);
  } catch (error) {
    console.error("❌ Token Error:", error.response?.data || error);
    return res.send("카카오 로그인 중 오류 발생");
  }
});



app.listen(port, () => {
  console.log(`🚀 Gemini 서버가 http://localhost:${port} 에서 실행 중`);
});