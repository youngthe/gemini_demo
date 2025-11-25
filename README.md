# 영미나이 (Gemini Chat Demo)



Node.js 백엔드 + React(TypeScript, Vite) 프론트엔드로 구성된 간단한 Gemini 챗봇 데모 프로젝트입니다.



\- 백엔드: Google Gemini API 호출 (Node.js / Express)

\- 프론트엔드: 질문 입력 + 응답 표시 UI (React + TS + Vite)



## 1. 필수 요구사항



\- Node.js (v18 이상 권장)

\- npm

\- Google Gemini API 키  

&nbsp; - https://aistudio.google.com 에서 발급  

&nbsp; - `.env` 파일에 `GEMINI\_API\_KEY`로 설정



## 2. 프로젝트 구조



```text

gemini\_project/

&nbsp; backend/     # Node.js 서버 (Gemini API 호출)

&nbsp; front/       # React + TypeScript (Vite 프론트엔드)

```



## 3. 백엔드 실행 방법 (Node.js 서버)

### 3-1. 의존성 설치

cd backend

npm install



### 3-2. 환경 변수(.env) 설정



backend 폴더 안에 .env 파일 생성:

GEMINI\_API\_KEY="gemini api key 입력"



### 3-3. 서버 실행

npm start



# 4. 프론트엔드 실행 방법 (React + Vite)

### 4-1. 의존성 설치

cd front

npm install



### 4-2. 개발 서버 실행

npm run dev





터미널에 다음과 같은 주소가 뜹니다:



&nbsp; VITE vX.X.X  ready in Xs



&nbsp; ➜  Local:   http://localhost:5173/





브라우저에서 http://localhost:5173 접속하면

영미나이 UI가 뜨고, 질문을 입력하면 백엔드(Gemini)에 요청을 보내 응답을 보여줍니다.



⚠️ 백엔드(Node 서버)가 먼저 실행 중이어야 합니다.

(http://localhost:3001/api/chat 에 접속 가능해야 함)

