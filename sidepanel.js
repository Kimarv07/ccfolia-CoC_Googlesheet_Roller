// sidepanel.js
// 사이드 패널의 핵심 로직: URL 저장/불러오기, CSV 파싱, 그룹화, 1클릭 전송

// ============================================================
// 전역 상태
// ============================================================
let selectedBot = "CC"; // 현재 선택된 다이스 봇 (CC 또는 CCB)

// ============================================================
// DOM 요소 참조
// ============================================================
const sheetUrlInput = document.getElementById("sheet-url");
const loadBtn = document.getElementById("load-btn");
const skillContainer = document.getElementById("skill-container");
const statusMsg = document.getElementById("status-msg");
const diceHint = document.getElementById("dice-hint");
const diceBtns = document.querySelectorAll(".dice-btn");
const contextMenu = document.getElementById("context-menu");
const ctxEdit = document.getElementById("ctx-edit");
const ctxDelete = document.getElementById("ctx-delete");
const ctxSubmenu = document.getElementById("ctx-submenu");
const toastMsg = document.getElementById("toast-msg");
const editModal = document.getElementById("edit-modal");
const editModalTitle = document.getElementById("edit-modal-title");
const editValueInput = document.getElementById("edit-value-input");
const editConfirm = document.getElementById("edit-confirm");
const editCancel = document.getElementById("edit-cancel");

// 수동 추가 모달 요소 (스킬)
const openAddBtn = document.getElementById("open-add-skill");
const addModal = document.getElementById("add-modal");
const addNameInput = document.getElementById("add-name-input");
const addValueInput = document.getElementById("add-value-input");
const addCategorySelect = document.getElementById("add-category-select");
const addConfirm = document.getElementById("add-confirm");
const addCancel = document.getElementById("add-cancel");

// 수동 추가 모달 요소 (카테고리)
const openAddCategoryBtn = document.getElementById("open-add-category");
const addCategoryModal = document.getElementById("add-category-modal");
const addCategoryInput = document.getElementById("add-category-input");
const addCategoryConfirm = document.getElementById("add-category-confirm");
const addCategoryCancel = document.getElementById("add-category-cancel");

// ============================================================
// 1. 초기화: 저장된 URL과 다이스 봇 설정을 불러옴
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["sheetUrl", "diceBot"]);

  if (saved.sheetUrl) {
    sheetUrlInput.value = saved.sheetUrl;
    // 저장된 URL이 있으면 자동으로 데이터 로드
    loadSkillsFromSheet(saved.sheetUrl);
  }

  if (saved.diceBot) {
    selectedBot = saved.diceBot;
    updateDiceBotUI(selectedBot);
  }
});

// ============================================================
// 2. 다이스 봇 선택 버튼 이벤트
// ============================================================
diceBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    selectedBot = btn.dataset.bot;
    updateDiceBotUI(selectedBot);
    chrome.storage.local.set({ diceBot: selectedBot });
  });
});

function updateDiceBotUI(bot) {
  diceBtns.forEach(b => b.classList.toggle("active", b.dataset.bot === bot));
  if (bot === "CC") {
    diceHint.textContent = "CC<=수치: 기본 성공/실패 판정";
  } else {
    diceHint.textContent = "CCB<=수치: 보너스/패널티 다이스 포함 판정";
  }
}

// ============================================================
// 3. 불러오기 버튼 클릭 이벤트
// ============================================================
loadBtn.addEventListener("click", () => {
  const rawUrl = sheetUrlInput.value.trim();
  if (!rawUrl) {
    showStatus("URL을 입력해주세요.", "error");
    return;
  }
  chrome.storage.local.set({ sheetUrl: rawUrl });
  loadSkillsFromSheet(rawUrl);
});

// ============================================================
// 4. 구글 시트 URL → CSV 변환 및 데이터 로드
// ============================================================
async function loadSkillsFromSheet(rawUrl) {
  showStatus("데이터를 불러오는 중...", "loading");

  try {
    // 구글 시트 URL에서 스프레드시트 ID를 추출하고 CSV 다운로드 주소로 변환합니다.
    // 일반 공유 주소: https://docs.google.com/spreadsheets/d/{ID}/edit?...
    // CSV 주소:       https://docs.google.com/spreadsheets/d/{ID}/export?format=csv
    const csvUrl = convertToCsvUrl(rawUrl);
    if (!csvUrl) {
      showStatus("올바른 구글 시트 URL이 아닙니다.", "error");
      return;
    }

    const response = await fetch(csvUrl, {
      cache: "no-store",
      credentials: "omit" // 로그인 세션 정보를 제외하여 로그인 페이지 리다이렉트 방지
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("시트를 찾을 수 없습니다. URL을 확인해주세요.");
      if (response.status === 403 || response.status === 401) throw new Error("시트 접근 권한이 없습니다. '링크가 있는 모든 사용자' 공유 설정을 확인해주세요.");
      throw new Error(`서버 응답 오류 (HTTP ${response.status})`);
    }

    const csvText = await response.text();
    // CSV 내용이 HTML(로그인 페이지 등)인지 체크
    if (csvText.includes("<!DOCTYPE html>") || csvText.includes("<html")) {
      throw new Error("시트가 비공개 상태이거나 로그인 페이지로 리다이렉트되었습니다.");
    }

    const skills = parseCsvToSkills(csvText);

    if (skills.length === 0) {
      showStatus("불러온 스킬이 없습니다. 시트 구조를 확인해주세요.", "error");
      return;
    }

    renderSkills(skills);
    showStatus(`${skills.length}개 스킬을 불러왔습니다! ✅`, "success");

  } catch (err) {
    console.error("스킬 불러오기 실패:", err);
    showStatus(`실패: ${err.message}`, "error");
  }
}

// 다양한 형태의 구글 시트 URL에서 CSV 다운로드 주소를 만드는 함수
function convertToCsvUrl(rawUrl) {
  try {
    // 정규식으로 URL에서 스프레드시트 고유 ID를 추출합니다.
    // ID는 '/d/' 와 다음 '/' 사이에 있는 긴 문자열입니다.
    const match = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return null;

    const sheetId = match[1];

    // gid(시트 탭 번호)가 URL에 있으면 그 시트의 데이터를 요청합니다.
    // gid가 없으면 첫 번째 탭(gid=0)으로 기본 설정합니다.
    const gidMatch = rawUrl.match(/[?&#]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";

    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return null;
  }
}

// ============================================================
// 5-A. 스킬명 특수기호 필터링
// ============================================================
// 스킬명에서 불필요한 특수기호를 제거합니다.
// 허용 문자: 한글, 영문, 숫자, 공백, 하이픈(-), 슬래시(/), 괄호 (), [], 점(.)
// 그 외의 특수기호(기호, 제어문자 등)는 모두 제거됩니다.
function cleanSkillName(name) {
  // 허용 문자 집합 외의 모든 문자를 빈 문자열로 치환합니다.
  return name
    .replace(/[^\p{L}\p{N} ()\[\]\-\/.·]/gu, "")
    .trim();
}

// ============================================================
// 5. CSV 텍스트 파싱 — 유연한 데이터 추출 로직
// ============================================================

// [전처리] 따옴표로 묶인 셀 내부의 줄바꿈을 제거합니다.
// 구글 시트에서 셀 내 줄바꿈이 있는 경우 CSV로 내보낼 때 "근\n력"처럼
// 따옴표 안에 개행이 포함됩니다. 이를 그냥 split(\n)하면 행이 쪼개져서
// "근"과 "력"이 서로 다른 행으로 분리됩니다.
// 이 함수는 따옴표 범위를 추적하며 그 안의 \r, \n만 제거(빈 문자열로 치환)합니다.
function normalizeCsvText(csvText) {
  let result = "";
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      result += ch;
    } else if (inQuotes && (ch === '\n' || ch === '\r')) {
      // 따옴표 안의 줄바꿈은 제거합니다 ("근\n력" → "근력")
    } else {
      result += ch;
    }
  }
  return result;
}

function parseCsvToSkills(csvText) {
  const skills = [];

  // 멀티라인 셀을 먼저 정규화한 뒤 줄 단위로 나눕니다.
  const rows = normalizeCsvText(csvText).split(/\r?\n/);

  rows.forEach(row => {
    // 각 줄을 쉼표(,) 기준으로 분리합니다.
    // 따옴표로 묶인 셀 안의 쉼표를 무시하는 파서를 사용합니다.
    const cols = splitCsvRow(row);

    // -----------------------------------------------------------
    // 전략 1: CoC 시트(FALSE/TRUE 마커 + 최대값) 패턴 탐색
    //
    // CoC 시트의 스킬 행은 다음과 같은 구조입니다:
    //   [FALSE, 기능명, 空, 기본값, 추가점수, 합계, 절반, 5분의1, ...]
    //
    // "합계가 항상 N번째 칸에 있다"고 확신할 수 없으므로,
    // 기능명 이후 다음 FALSE/TRUE 마커 전까지 등장하는 숫자(1~100) 중
    // 가장 큰 값을 최종 수치로 사용합니다.
    // → 예: 기본(27), 추가(30), 합계(57), 절반(28), 1/5(11) 중 max = 57 ✅
    // -----------------------------------------------------------
    let i = 0;
    while (i < cols.length) {
      const flag = cols[i].trim().toUpperCase();

      if (flag === "FALSE" || flag === "TRUE") {
        // --- 기능명 추출 (멀티 셀 지원) ---
        // 마커(FALSE/TRUE) 이후부터 숫자(수치)가 나오기 전까지의 모든 텍스트를 이름으로 간주합니다.
        // 예: [사격, , 권총] -> "사격(권총)"
        let nameParts = [];
        let j = i + 1;
        let numericStartIndex = -1;

        while (j < cols.length) {
          const content = cols[j].trim().replace(/^"|"$/g, "");
          const isMarker = content.toUpperCase() === "FALSE" || content.toUpperCase() === "TRUE";
          const isNum = /^\d+$/.test(content);

          if (isMarker) break;
          if (isNum) {
            numericStartIndex = j;
            break;
          }

          if (content) nameParts.push(content);
          j++;
        }

        if (nameParts.length > 0) {
          let fullName = nameParts[0];
          if (nameParts.length > 1) {
            fullName += `(${nameParts.slice(1).join("/")})`;
          }

          // --- 수치 추출 ---
          // 이름 파트 이후부터 다음 마커 전까지의 숫자 중 최대값을 찾습니다.
          let maxValue = -1;
          let k = (numericStartIndex !== -1) ? numericStartIndex : j;

          while (k < cols.length) {
            const nextFlag = cols[k].trim().toUpperCase();
            if (nextFlag === "FALSE" || nextFlag === "TRUE") break;

            const num = parseInt(cols[k].trim().replace(/^"|"$/g, ""), 10);
            if (!isNaN(num) && num >= 1 && num <= 900) {
              maxValue = Math.max(maxValue, num);
            }
            k++;
          }

          // cleanSkillName()으로 특수기호를 제거한 뒤 저장합니다.
          const cleanedName = cleanSkillName(fullName);
          if (maxValue > 0 && cleanedName && !skills.some(s => s.name === cleanedName)) {
            skills.push({ name: cleanedName, value: maxValue });
          }

          i = k; // 다음 블록 시작 위치로 이동
          continue;
        }
      }
      i++;
    }

    // -----------------------------------------------------------
    // 전략 2: 일반 패턴 Fallback — "기능명(문자열), 수치(숫자)" 인접 쌍 탐색
    // 이 행에 FALSE/TRUE 마커가 없는 단순 시트(A열=이름, B열=수치)를 처리합니다.
    // -----------------------------------------------------------
    const rowHasMarker = cols.some(
      c => c.trim().toUpperCase() === "FALSE" || c.trim().toUpperCase() === "TRUE"
    );
    if (rowHasMarker) return; // 전략 1이 처리한 행은 건너뜁니다.

    for (let k = 0; k < cols.length - 1; k++) {
      const name = cols[k].trim().replace(/^"|"$/g, "");
      
      // 이름 후보가 유효한 문자열이고 숫자가 아닐 때
      if (name && !/^\d+$/.test(name)) {
        // 이름 바로 다음 칸부터 최대 3칸 이내에서 숫자를 찾아봅니다. (빈 칸 건너뛰기 지원)
        for (let offset = 1; offset <= 3; offset++) {
          if (k + offset >= cols.length) break;
          
          const value = cols[k + offset].trim().replace(/^"|"$/g, "");
          if (!value) continue; // 빈 칸이면 다음 칸 확인

          if (/^\d+$/.test(value)) {
            const num = parseInt(value, 10);
            if (num >= 1 && num <= 900) {
              const cleanedName = cleanSkillName(name);
              if (cleanedName && !skills.some(s => s.name === cleanedName)) {
                skills.push({ name: cleanedName, value: num });
              }
              // 값을 찾았으므로 k를 이동시켜 중복 방지
              k += offset;
            }
            break; // 숫자를 만났으므로 (유효하건 아니건) 이 이름에 대한 탐색은 종료
          } else {
            // 문자를 만났다면 이름-수치 쌍이 아니라고 판단하고 종료
            break;
          }
        }
      }
    }
  });

  return skills;
}

// 따옴표로 묶인 셀을 고려한 간단한 CSV 행 파서
function splitCsvRow(row) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// ============================================================
// 6. 스킬 목록 렌더링 — config.js의 categoryMapping으로 그룹화
// ============================================================
function renderSkills(skills) {
  skillContainer.innerHTML = ""; // 기존 스킬 데이터 전체 초기화

  // 스킬이 없을 때는 안내 메시지를 띄웁니다.
  if (!skills || skills.length === 0) {
    skillContainer.innerHTML = `<p class="placeholder-text">위에서 구글 시트를 불러오면<br />스킬 목록이 여기에 표시됩니다.</p>`;
    return;
  }
  // --- 그룹화 작업 ---
  // config.js의 categoryMapping을 사용해 스킬을 카테고리별로 분류합니다.
  // 어느 카테고리에도 속하지 않는 스킬은 "기타"로 자동 분류합니다.
  const grouped = {};

  Object.keys(categoryMapping).forEach(cat => {
    grouped[cat] = [];
  });
  grouped["기타"] = [];

  skills.forEach(skill => {
    let found = false;
    for (const [cat, keywords] of Object.entries(categoryMapping)) {
      // 100% 일치하거나, 카테고리 매핑 내 단어가 기능 이름에 포함되어 있는지 확인 (유사어)
      if (keywords.some(k => skill.name.includes(k) || k.includes(skill.name))) {
        grouped[cat].push(skill);
        found = true;
        break;
      }
    }
    if (!found) grouped["기타"].push(skill);
  });

  // --- 카테고리 블록 렌더링 ---
  Object.entries(grouped).forEach(([catName, catSkills]) => {
    // 스킬이 하나도 없는 카테고리는 표시하지 않습니다.
    if (catSkills.length === 0) return;

    const block = document.createElement("div");
    block.className = "category-block open"; // 기본으로 모두 펼쳐진 상태

    // 카테고리 헤더 (클릭하면 접기/펼치기)
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <span class="category-title">${catName}</span>
      <span>
        <span class="category-count">${catSkills.length}개</span>
        <span class="category-arrow">▼</span>
      </span>
    `;
    header.addEventListener("click", () => {
      block.classList.toggle("open");
    });

    // 카테고리 본문 (스킬 목록)
    const body = document.createElement("div");
    body.className = "category-body";

    catSkills.forEach(skill => {
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `
        <span class="skill-name">${skill.name}</span>
        <span>
          <span class="skill-value">${skill.value}</span>
          <span class="skill-click-hint">클릭</span>
        </span>
      `;

      // ★ 1회 클릭으로 즉시 주사위 명령 전송 ★
      row.addEventListener("click", () => {
        const command = `${selectedBot}<=${skill.value} 【${skill.name}】`;
        sendRollCommand(command);
      });

      // ★ 우클릭 컨텍스트 메뉴 ★
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, skill, row);
      });

      body.appendChild(row);
    });

    block.appendChild(header);
    block.appendChild(body);
    skillContainer.appendChild(block);
  });
}

// ============================================================
// 7. 코코포리아 탭으로 주사위 명령 전송
// ============================================================
async function sendRollCommand(command) {
  // 현재 활성화된 탭을 찾습니다.
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab) {
    showStatus("코코포리아 탭을 찾을 수 없습니다.", "error");
    return;
  }

  // content.js로 메시지를 전송합니다. content.js가 실제 채팅창에 명령어를 주입합니다.
  chrome.tabs.sendMessage(tab.id, { action: "roll", command }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus("전송 실패: 코코포리아 방 페이지인지 확인해주세요.", "error");
    }
  });
}

// ============================================================
// 8. 상태 메시지 표시 유틸리티
// ============================================================
function showStatus(msg, type = "loading") {
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg ${type}`;

  // 성공/오류 메시지는 3초 후 자동으로 사라집니다.
  if (type === "success" || type === "error") {
    setTimeout(() => {
      statusMsg.className = "status-msg hidden";
    }, 3000);
  }
}

// ============================================================
// 9. 우클릭 컨텍스트 메뉴 로직
// ============================================================
let _ctxSkill = null; // 현재 우클릭한 스킬 객체
let _ctxRow = null; // 현재 우클릭한 행 DOM 요소

function showContextMenu(x, y, skill, row) {
  _ctxSkill = skill;
  _ctxRow = row;

  // 카테고리 이동 서브메뉴 채우기
  populateCategorySubmenu(skill, row);

  // 1. 일단 메뉴를 투명하게 표시해서 크기를 잽니다 (크기 계산용)
  contextMenu.style.visibility = "hidden";
  contextMenu.classList.remove("hidden");

  const menuWidth = contextMenu.offsetWidth;
  const menuHeight = contextMenu.offsetHeight;
  const submenuWidth = 140; // CSS min-width 기준
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const centerX = windowWidth / 2;

  // 2. 가로 위치 조정 (중앙 기준 법칙 + 여유 공간 체크)
  let finalX = x;
  let finalY = y;

  if (x < centerX) {
    // 마우스가 왼쪽 - 오른쪽으로 메뉴 펼침
    finalX = x;
    // 만약 오른쪽 끝으로 서브메뉴가 나간다면?
    if (finalX + menuWidth + submenuWidth > windowWidth) {
      // 최대한 오른쪽 끝에 붙임
      finalX = windowWidth - menuWidth - submenuWidth - 5;
    }
    ctxSubmenu.style.left = "100%";
    ctxSubmenu.style.right = "auto";
  } else {
    // 마우스가 오른쪽 - 왼쪽으로 메뉴 펼침
    finalX = x - menuWidth;
    // 만약 왼쪽 끝으로 서브메뉴가 나간다면?
    if (finalX - submenuWidth < 0) {
      // 최대한 왼쪽 끝에 붙임
      finalX = submenuWidth + 5;
    }
    ctxSubmenu.style.left = "auto";
    ctxSubmenu.style.right = "100%";
  }

  // 3. 세로 위치 조정 (바닥 공간 체크)
  if (finalY + menuHeight > windowHeight) {
    finalY = windowHeight - menuHeight - 10;
  }

  // 3-1. 서브메뉴(카테고리 목록) 세로 위치 보정
  // 서브메뉴의 높이를 측정합니다. (max-height: 200px 고려)
  const realSubmenuHeight = ctxSubmenu.offsetHeight || 200;
  // '카테고리 이동' 버튼의 상단 위치 = 메뉴 시작점(finalY) + 첫 번째 버튼 높이(약 36px)
  const categoryBtnTop = finalY + 36;

  if (categoryBtnTop + realSubmenuHeight > windowHeight) {
    // 바닥을 뚫고 나간다면 아래쪽을 부모 버튼의 하단에 맞춤 (또는 화면 끝에 맞춤)
    ctxSubmenu.style.top = "auto";
    ctxSubmenu.style.bottom = "0";
  } else {
    ctxSubmenu.style.top = "0";
    ctxSubmenu.style.bottom = "auto";
  }

  // 4. 최종 화면 경계 방어 (절대 나가지 않게)
  if (finalX < 5) finalX = 5;
  if (finalX + menuWidth > windowWidth - 5) {
    finalX = windowWidth - menuWidth - 5;
  }
  if (finalY < 5) finalY = 5;

  contextMenu.style.left = `${finalX}px`;
  contextMenu.style.top = `${finalY}px`;
  contextMenu.style.visibility = "visible";
}

function hideContextMenu() {
  contextMenu.classList.add("hidden");
  _ctxSkill = null;
  _ctxRow = null;
}

// 서브메뉴(카테고리 이동) 항목 생성
function populateCategorySubmenu(skill, row) {
  ctxSubmenu.innerHTML = "";
  const currentCategoryBlock = row.closest(".category-block");
  const currentCatName = currentCategoryBlock.querySelector(".category-title").textContent;

  // config.js 의 설정된 모든 카테고리 + "기타"
  const allCategories = Object.keys(categoryMapping);
  if (!allCategories.includes("기타")) allCategories.push("기타");

  allCategories.forEach(catName => {
    if (catName === currentCatName) return; // 현재 카테고리는 제외

    const btn = document.createElement("button");
    btn.textContent = `➡ ${catName}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // 부모 메뉴 클릭 이벤트 방지
      moveSkillToCategory(catName);
    });
    ctxSubmenu.appendChild(btn);
  });
}

function moveSkillToCategory(targetCatName) {
  if (!_ctxRow) return;

  // 1. 기존 카테고리에서 행 제거 (비어있으면 블록 자체 제거)
  const oldBody = _ctxRow.closest(".category-body");
  const oldBlock = oldBody.closest(".category-block");
  const oldHeaderCount = oldBlock.querySelector(".category-count");

  const rowToMove = _ctxRow; // DOM 참조 저장
  rowToMove.remove();

  if (oldBody.children.length === 0) {
    oldBlock.remove();
  } else {
    oldHeaderCount.textContent = `${oldBody.children.length}개`;
  }

  // 2. 타겟 카테고리 블록 찾기
  let targetBlock = null;
  document.querySelectorAll(".category-block").forEach(block => {
    if (block.querySelector(".category-title").textContent === targetCatName) {
      targetBlock = block;
    }
  });

  // 3. 타겟 카테고리가 없으면 새로 생성
  if (!targetBlock) {
    targetBlock = document.createElement("div");
    targetBlock.className = "category-block open";
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <span class="category-title">${targetCatName}</span>
      <span>
        <span class="category-count">0개</span>
        <span class="category-arrow">▼</span>
      </span>
    `;
    header.addEventListener("click", () => targetBlock.classList.toggle("open"));

    const body = document.createElement("div");
    body.className = "category-body";

    targetBlock.appendChild(header);
    targetBlock.appendChild(body);
    skillContainer.appendChild(targetBlock);
  }

  // 4. 타겟 카테고리에 행 추가 및 개수 업데이트
  const targetBody = targetBlock.querySelector(".category-body");
  targetBody.appendChild(rowToMove);
  targetBlock.querySelector(".category-count").textContent = `${targetBody.children.length}개`;
  targetBlock.classList.add("open"); // 넣은 카테고리는 자동으로 펼쳐줌

  hideContextMenu();
  showToast(`[${_ctxSkill.name}] 항목을 '${targetCatName}'(으)로 이동했습니다.`);
}

// 다른 곳 클릭 시 메뉴 닫기
document.addEventListener("click", (e) => {
  if (!e.target.closest(".context-menu")) {
    hideContextMenu();
  }
});
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest(".skill-row") && !e.target.closest(".context-menu")) {
    hideContextMenu();
  }
});

// 수치 수정 버튼
ctxEdit.addEventListener("click", () => {
  if (!_ctxSkill || !_ctxRow) return;
  const skill = _ctxSkill;
  const row = _ctxRow;
  hideContextMenu();
  openEditModal(skill, row);
});

// 기능 삭제 버튼
ctxDelete.addEventListener("click", () => {
  if (!_ctxRow) return;
  const body = _ctxRow.closest(".category-body");
  const block = body?.closest(".category-block");
  _ctxRow.remove();
  // 카테고리 본문이 비면 카테고리 블록 전체를 숨깁니다.
  if (body && block && body.children.length === 0) {
    block.remove();
  } else if (block) {
    block.querySelector(".category-count").textContent = `${body.children.length}개`;
  }
  showToast("항목을 삭제했습니다.");
  hideContextMenu();
});

// ============================================================
// 10. 수치 편집 모달 로직
// ============================================================
function openEditModal(skill, row) {
  editModalTitle.textContent = `"${skill.name}" 수치 수정`;
  editValueInput.value = skill.value;
  editModal.classList.remove("hidden");
  editValueInput.focus();
  editValueInput.select();

  // 확인: 유효한 값이면 저장하고 화면에 반영
  const onConfirm = () => {
    const newVal = parseInt(editValueInput.value, 10);
    if (isNaN(newVal) || newVal < 1 || newVal > 100) {
      editValueInput.style.borderColor = "#f44336";
      setTimeout(() => { editValueInput.style.borderColor = ""; }, 800);
      return;
    }
    skill.value = newVal;
    const valueSpan = row.querySelector(".skill-value");
    if (valueSpan) valueSpan.textContent = newVal;
    // 클릭 이벤트가 이미 skill 객체를 참조하므로 자동으로 새 수치 적용
    closeEditModal();
    cleanup();
  };

  const onCancel = () => { closeEditModal(); cleanup(); };

  // Enter / Escape 키보드 단축키 지원
  const onKey = (e) => {
    if (e.key === "Enter") onConfirm();
    if (e.key === "Escape") onCancel();
  };

  function cleanup() {
    editConfirm.removeEventListener("click", onConfirm);
    editCancel.removeEventListener("click", onCancel);
    editValueInput.removeEventListener("keydown", onKey);
  }

  editConfirm.addEventListener("click", onConfirm);
  editCancel.addEventListener("click", onCancel);
  editValueInput.addEventListener("keydown", onKey);
}

// ============================================================
// 11. 토스트 메시지 (알림)
// ============================================================
let toastTimeout;
function showToast(msg) {
  toastMsg.textContent = msg;
  toastMsg.classList.remove("hidden");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastMsg.classList.add("hidden");
  }, 2500);
}

function closeEditModal() {
  editModal.classList.add("hidden");
}

// ============================================================
// 12. 기능 수동 추가 로직
// ============================================================
openAddBtn.addEventListener("click", () => {
  addModal.classList.remove("hidden");
  addNameInput.value = "";
  addValueInput.value = "";
  addNameInput.focus();

  const onConfirm = () => {
    const rawName = addNameInput.value;
    const cleanedName = cleanSkillName(rawName);
    const value = parseInt(addValueInput.value, 10);

    if (!cleanedName) {
      addNameInput.style.borderColor = "#f44336";
      setTimeout(() => { addNameInput.style.borderColor = ""; }, 800);
      return;
    }
    if (isNaN(value) || value < 1 || value > 100) {
      addValueInput.style.borderColor = "#f44336";
      setTimeout(() => { addValueInput.style.borderColor = ""; }, 800);
      return;
    }

    // 새 스킬 객체 생성
    const newSkill = { name: cleanedName, value: value };
    const selectedCat = addCategorySelect.value === "AUTO" ? null : addCategorySelect.value;
    createSkillElement(newSkill, selectedCat);

    closeAddModal();
    cleanup();
    showToast(`'${cleanedName}' (수치: ${value}) 기능이 추가되었습니다.`);
  };

  // 카테고리 드롭다운 동적 구성
  function populateAddCategoryDropdown() {
    // 기본 옵션 유지 (AUTO, 기타)
    addCategorySelect.innerHTML = `
      <option value="AUTO">-- 자동 분류 --</option>
      <option value="기타">기타</option>
    `;

    // 현재 화면에 있는 카테고리들 추가
    const existingCats = [];
    document.querySelectorAll(".category-block").forEach(block => {
      const name = block.querySelector(".category-title").textContent;
      if (name !== "기타") existingCats.push(name);
    });

    // config.js의 모든 카테고리도 후보군에 추가 (중복 제거)
    Object.keys(categoryMapping).forEach(cat => {
      if (!existingCats.includes(cat) && cat !== "기타") existingCats.push(cat);
    });

    existingCats.sort().forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      addCategorySelect.appendChild(opt);
    });
  }

  populateAddCategoryDropdown();

  const onCancel = () => { closeAddModal(); cleanup(); };

  const onKey = (e) => {
    if (e.key === "Enter") onConfirm();
    if (e.key === "Escape") onCancel();
  };

  function cleanup() {
    addConfirm.removeEventListener("click", onConfirm);
    addCancel.removeEventListener("click", onCancel);
    addNameInput.removeEventListener("keydown", onKey);
    addValueInput.removeEventListener("keydown", onKey);
  }

  addConfirm.addEventListener("click", onConfirm);
  addCancel.addEventListener("click", onCancel);
  addNameInput.addEventListener("keydown", onKey);
  addValueInput.addEventListener("keydown", onKey);
});

function closeAddModal() {
  addModal.classList.add("hidden");
}

// 스킬 DOM 요소를 단일 생성하여 알맞은 카테고리에 붙여주는 함수
function createSkillElement(skill, forceCategory = null) {
  // 1. 카테고리 판별 (유사어 감지 로직 적용)
  let targetCatName = forceCategory || "기타";

  if (!forceCategory) {
    for (const [cat, keywords] of Object.entries(categoryMapping)) {
      // 100% 일치하거나, 카테고리 매핑 내 단어가 기능 이름에 포함되어 있는지 확인 (유사어)
      if (keywords.some(k => skill.name.includes(k) || k.includes(skill.name))) {
        targetCatName = cat;
        break;
      }
    }
  }

  // 2. 카테고리 블록 찾거나 새로 생성
  let targetBlock = null;
  document.querySelectorAll(".category-block").forEach(block => {
    if (block.querySelector(".category-title").textContent === targetCatName) {
      targetBlock = block;
    }
  });

  if (!targetBlock) {
    targetBlock = document.createElement("div");
    targetBlock.className = "category-block open";
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <span class="category-title">${targetCatName}</span>
      <span>
        <span class="category-count">0개</span>
        <span class="category-arrow">▼</span>
      </span>
    `;
    header.addEventListener("click", () => targetBlock.classList.toggle("open"));

    const body = document.createElement("div");
    body.className = "category-body";

    targetBlock.appendChild(header);
    targetBlock.appendChild(body);
    skillContainer.appendChild(targetBlock); // 임시로 붙임 (만약 비어있었다면 renderSkills가 덮어씌웠을 테지만, 개별 추가이므로 맨 밑에 추가)
    // 위치를 알파벳순이나 처음으로 넣고 싶을 수 있지만, 여기서는 단순히 영역 마지막에 붙임.
  }

  // 3. 행(row) 요소 생성
  const row = document.createElement("div");
  row.className = "skill-row";
  row.innerHTML = `
    <span class="skill-name">${skill.name}</span>
    <span>
      <span class="skill-value">${skill.value}</span>
      <span class="skill-click-hint">클릭</span>
    </span>
  `;

  row.addEventListener("click", () => {
    const command = `${selectedBot}<=${skill.value} 【${skill.name}】`;
    sendRollCommand(command);
  });

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, skill, row);
  });

  // 4. 부착
  const targetBody = targetBlock.querySelector(".category-body");
  targetBody.appendChild(row);
  targetBlock.querySelector(".category-count").textContent = `${targetBody.children.length}개`;

  // placeholder 텍스트 제거 (있다면)
  const placeholder = skillContainer.querySelector(".placeholder-text");
  if (placeholder) placeholder.remove();
}

// ============================================================
// 13. 카테고리 수동 추가 로직
// ============================================================
openAddCategoryBtn.addEventListener("click", () => {
  addCategoryModal.classList.remove("hidden");
  addCategoryInput.value = "";
  addCategoryInput.focus();

  const onConfirm = () => {
    const rawName = addCategoryInput.value;
    const cleanedName = cleanSkillName(rawName);

    if (!cleanedName) {
      addCategoryInput.style.borderColor = "#f44336";
      setTimeout(() => { addCategoryInput.style.borderColor = ""; }, 800);
      return;
    }

    // 타겟 카테고리 렌더링 검사
    let targetBlock = null;
    document.querySelectorAll(".category-block").forEach(block => {
      if (block.querySelector(".category-title").textContent === cleanedName) {
        targetBlock = block;
      }
    });

    if (!targetBlock) {
      targetBlock = document.createElement("div");
      targetBlock.className = "category-block open";
      const header = document.createElement("div");
      header.className = "category-header";
      header.innerHTML = `
        <span class="category-title">${cleanedName}</span>
        <span>
          <span class="category-count">0개</span>
          <span class="category-arrow">▼</span>
        </span>
      `;
      header.addEventListener("click", () => targetBlock.classList.toggle("open"));

      const body = document.createElement("div");
      body.className = "category-body";

      targetBlock.appendChild(header);
      targetBlock.appendChild(body);
      skillContainer.appendChild(targetBlock);
    }

    closeAddCategoryModal();
    cleanup();
    showToast(`'${cleanedName}' 카테고리가 생성되었습니다.`);

    // placeholder 제거
    const placeholder = skillContainer.querySelector(".placeholder-text");
    if (placeholder) placeholder.remove();
  };

  const onCancel = () => { closeAddCategoryModal(); cleanup(); };

  const onKey = (e) => {
    if (e.key === "Enter") onConfirm();
    if (e.key === "Escape") onCancel();
  };

  function cleanup() {
    addCategoryConfirm.removeEventListener("click", onConfirm);
    addCategoryCancel.removeEventListener("click", onCancel);
    addCategoryInput.removeEventListener("keydown", onKey);
  }

  addCategoryConfirm.addEventListener("click", onConfirm);
  addCategoryCancel.addEventListener("click", onCancel);
  addCategoryInput.addEventListener("keydown", onKey);
});

function closeAddCategoryModal() {
  addCategoryModal.classList.add("hidden");
}
