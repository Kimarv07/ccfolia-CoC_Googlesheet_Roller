// background.js
// 확장 프로그램 아이콘을 클릭하면 사이드 패널을 열도록 설정합니다.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("사이드 패널 설정 오류:", error));
