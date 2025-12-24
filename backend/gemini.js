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
const port = 3001;

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
    case "luck":
      return `
너는 JSON만 출력하는 생성기다.
"오늘의 운세"에 맞는 한국어 텍스트를 생성해라.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title은 10자 이내, content는 80자 이내로 한다.
- content는 오늘 하루의 전반적인 운, 금전운, 연애운 등을 간단히 조언 형식으로 적는다.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.

예시 형식:
[
  { "title": "오늘의 운세", "content": "..." },
  { "title": "금전 운", "content": "..." }
]
`;

    case "jokes":
      return `
너는 JSON만 출력하는 생성기다.
"아재개그"에 해당하는 한국어 개그를 몇 개 만든다.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title에는 개그 제목이나 질문을 넣고, content에는 답 또는 한 줄 개그를 적는다.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.
- 8가지 이상 결과값을 반환한다.

예시 형식:
[
  { "title": "소금이 죽으면?", "content": "염장 지른다." },
  { "title": "컴퓨터가 싫어하는 술은?", "content": "버그주." }
]
`;

    case "stocks":
      return `
너는 JSON만 출력하는 생성기다.
"오늘의 주식" 코멘트를 한국어로 만든다.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title에는 국내 또는 글로벌 주식/섹터 이름을 적는다. (예: 삼성전자, 2차전지 섹터)
- content에는 오늘 시장에 대한 간단한 전망이나 유의사항을 80자 이내로 작성한다.
- 투자 권유가 아닌 참고용 멘트로 적어라.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.
`;

    case "news":
      return `
너는 JSON만 출력하는 생성기다.
"이번주 뉴스"에 해당하는 주요 경제/사회 이슈를 한국어로 요약한다.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title에는 뉴스 헤드라인 느낌의 짧은 제목을 적는다.
- content에는 2~3줄 분량(100자 이내)으로 요약 내용을 작성한다.
- 국내/해외 주요 이슈를 섞어서 작성해도 된다.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.
- 5가지 이상 응답한다.
`;

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
------------------------------------------------------------------------ */
refreshAllTodayData();
setInterval(refreshAllTodayData, 60 * 60 * 1000); // 1시간마다 실행

/* ---------------------------------------------------------------------
  📌 오늘 데이터 API
------------------------------------------------------------------------ */
app.get("/today/luck", (req, res) => res.json(todayData.luck));
app.get("/today/jokes", (req, res) => res.json(todayData.jokes));
app.get("/today/stocks", (req, res) => res.json(todayData.stocks));
app.get("/today/news", (req, res) => res.json(todayData.news));

/* ---------------------------------------------------------------------
  📌 Gemini Chat API (기존 기능 유지)
------------------------------------------------------------------------ */
app.post('/api/chat', async (req, res) => {
  try {
    let { message } = req.body;
    message += " 응답을 3가지 요약 + 추천 근거 포함, 150자 이내.";

    const result = await model.generateContent(message);
    const text = result.response.text();

    lastGeminiReply = text;

    res.json({ text });
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
