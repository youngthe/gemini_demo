import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import cors from "cors";
import session from "express-session";
import axios from "axios";
import qs from "qs";

const apiKey = process.env.GEMINI_API_KEY;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

let lastGeminiReply = "";

// 환경변수 체크
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}

const app = express();
const port = 3002;

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

// Gemini 모델 초기화
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/* ---------------------------------------------------------------------
  📌 오늘 데이터 저장 공간 (메모리)
------------------------------------------------------------------------ */
const todayData = {
  luck: [],
  jokes: [],
  stocks: [],
  news: [],
};

/* ---------------------------------------------------------------------
  📌 카테고리별 Gemini 프롬프트 생성
------------------------------------------------------------------------ */
function buildPromptForCategory(category) {
  switch (category) {
case "motor":
      return `
너는 JSON만 출력하는 생성기다.
"조건에 value = "" 로 들어오는 데이터를 분석해서, motor를 몇도로 이동하라고 하는건지 angle을 분석해서 {"endpoint : "/motor", "angle" :  }" 형식으로 angle에 적절한 값을 반환해"
조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "angle": int } 형식이다.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
`;

    default:
      return "[]";
  }
}

/* ---------------------------------------------------------------------
  📌 Gemini로 데이터 생성 → todayData 갱신
------------------------------------------------------------------------ */
async function refreshCategory(category) {
  try {
    const prompt = buildPromptForCategory(category);
    const result = await model.generateContent(prompt);

    let text = result.response.text().trim();

    // ```json 제거
    if (text.startsWith("```")) {
      text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(text);

    if (Array.isArray(parsed) && parsed.length > 0) {
      todayData[category] = parsed;
      console.log(`✅ [${category}] 데이터 갱신 완료`);
    }
  } catch (err) {
    console.error(`❌ [${category}] 갱신 실패:`, err.message);
  }
}

/* ---------------------------------------------------------------------
  📌 모든 카테고리 한번에 갱신
------------------------------------------------------------------------ */
async function refreshAllTodayData() {
  console.log("🔄 Gemini 데이터 갱신 시작");
  await Promise.all([
    refreshCategory("luck"),
    refreshCategory("jokes"),
    refreshCategory("stocks"),
    refreshCategory("news"),
  ]);
  console.log("🔄 Gemini 데이터 갱신 완료");
}

/* ---------------------------------------------------------------------
  📌 서버 시작 시 1회 갱신 + 1시간마다 자동 갱신
// ------------------------------------------------------------------------ */
// refreshAllTodayData();
// setInterval(refreshAllTodayData, 60 * 60 * 1000); // 1시간마다 실행

/* ---------------------------------------------------------------------
  📌 오늘 데이터 API
------------------------------------------------------------------------ */
// app.get("/today/luck", (req, res) => res.json(todayData.luck));
// app.get("/today/jokes", (req, res) => res.json(todayData.jokes));
// app.get("/today/stocks", (req, res) => res.json(todayData.stocks));
// app.get("/today/news", (req, res) => res.json(todayData.news));

/* ---------------------------------------------------------------------
  📌 Gemini Chat API (기존 기능 유지)
------------------------------------------------------------------------ */
app.post("/command", async (req, res) => {
  try {
    let { message } = req.body;
    message =
    `너는 오직 JSON 배열만 출력하는 "모터 명령 해석기"이다. 입력으로 들어오는 value="<message>" 문자열은 음성을 텍스트로 변환한 결과이다.
    너는 이 텍스트를 분석해 모터를 몇 도로 이동해야 하는지 angle 값을 계산한다.

규칙:
- 출력은 반드시 JSON 배열만 가능하며, 다른 어떤 글자도 출력해선 안 된다.
- 배열의 각 요소는 반드시 다음 형식을 따른다:
   { "title": string, "angle": int }
- 텍스트 안에 "몇 도", "몇도로", "각도", "회전" 같은 이동 지시가 있으면 해당 숫자를 angle로 설정한다.
- 명확한 숫자가 없어도 사용자가 사전에 학습한 명령어(예: "짝수" → 90도)를 인식해서 angle을 반환해야 한다.
- 이동 지시가 전혀 없다면, 너는 미리 학습한 명령 규칙에 기반하여 angle 값을 추론해 반환한다.
- angle 값이 없을 수는 없으며 반드시 정수(int)로 포함되어야 한다.
- JSON 외의 문자열, 코드블록, 설명, 안내 문구는 절대 출력하지 마라.
value="` + message + "\"";

    const result = await model.generateContent(message);
    let text = result.response.text().trim();

    console.log("🔹 원본 text:", text);

    // 1) ```json, ``` 코드블록 제거
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    console.log("🔹 코드블록 제거 후:", text);

    // 2) JSON 파싱 (배열이라고 가정)
    const parsed = JSON.parse(text); // ex) [ { title, angle } ]

    // 3) 프론트에서 쓰기 쉽게 첫 번째 요소만 보내기
    const first = Array.isArray(parsed) ? parsed[0] : parsed;

    // ex) { "title": "모터 이동", "angle": 30 }
    res.json(first);
  } catch (err) {
    console.error("❌ Chat 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

/* ---------------------------------------------------------------------
  📌 카카오 메시지 전송
------------------------------------------------------------------------ */
app.get("/login/kakao", (req, res) => {
  req.session.kakaoAccessToken = null;

  const kakaoAuthUrl =
    "https://kauth.kakao.com/oauth/authorize?" +
    `client_id=${KAKAO_REST_API_KEY}&` +
    `redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&` +
    "response_type=code&scope=talk_message&prompt=consent";

  res.redirect(kakaoAuthUrl);
});

app.get("/oauth/kakao/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post(
      "https://kauth.kakao.com/oauth/token",
      qs.stringify({
        grant_type: "authorization_code",
        client_id: KAKAO_REST_API_KEY,
        redirect_uri: KAKAO_REDIRECT_URI,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;
    req.session.kakaoAccessToken = accessToken;

    const text =
      lastGeminiReply.trim() || "안녕하세요! (아직 Gemini 응답이 없습니다.)";

    await axios.post(
      "https://kapi.kakao.com/v2/api/talk/memo/default/send",
      qs.stringify({
        template_object: JSON.stringify({
          object_type: "text",
          text,
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

    res.send(`<h2>카카오 메시지 전송 성공!</h2>`);
  } catch (err) {
    console.error("❌ Kakao Error:", err.response?.data || err);
    res.send("카카오 로그인 오류");
  }
});

/* ---------------------------------------------------------------------
  📌 서버 시작
------------------------------------------------------------------------ */
app.listen(port, () => {
  console.log(`🚀 서버 실행됨 → http://localhost:${port}`);
});
