// content.js
// 코코포리아 웹페이지에 주입되는 스크립트입니다.
// 이 파일은 UI 생성 없이, 사이드 패널로부터 '굴리기 명령'을 받아
// 코코포리아 채팅창에 자동으로 입력하고 전송하는 역할만 합니다.

// ============================================================
// 사이드 패널로부터 메시지 수신 대기
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "roll") {
    const success = sendToCcfoliaChat(message.command);
    sendResponse({ success });
  }
  // true를 반환해야 비동기 응답이 가능합니다.
  return true;
});

// ============================================================
// 코코포리아 채팅창 자동 조종 (React Input Hack)
// ============================================================
// 코코포리아는 React.js로 만들어져 있어, 단순히 input.value = "값"만으로는
// React 내부 상태가 업데이트되지 않아 전송 버튼이 작동하지 않습니다.
// 이를 해결하기 위해 브라우저의 네이티브 value setter를 직접 호출하고,
// React가 감지하는 'input' 이벤트를 강제로 발생시킵니다.
function sendToCcfoliaChat(text) {
  // 코코포리아의 채팅 입력창을 찾습니다.
  // Material UI의 textarea를 우선적으로 찾고, 없으면 일반 textarea를 사용합니다.
  const chatInput =
    document.querySelector(".MuiInputBase-inputMultiline") ||
    document.querySelector("textarea");

  if (!chatInput) {
    console.warn("[CCFOLIA Auto Roller] 채팅 입력창을 찾지 못했습니다.");
    return false;
  }

  // 1단계: 네이티브 setter로 값 설정 (React가 인식할 수 있도록)
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;
  nativeSetter.call(chatInput, text);

  // 2단계: 'input' 이벤트를 발생시켜 React에게 값이 바뀌었음을 알림
  chatInput.dispatchEvent(new Event("input", { bubbles: true }));

  // 3단계: 전송 처리 — 전송 버튼 클릭 우선, 없으면 Enter 키 이벤트로 처리
  const sendButton =
    chatInput.closest("form")?.querySelector('button[type="submit"]') ||
    chatInput.parentElement?.parentElement?.querySelector("button:last-of-type");

  if (sendButton) {
    sendButton.click();
  } else {
    // 버튼을 찾지 못한 경우 Enter 키 이벤트로 대체합니다.
    chatInput.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
      })
    );
  }

  return true;
}
