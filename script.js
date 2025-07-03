const imageUpload = document.getElementById('imageUpload');
const originalCanvas = document.getElementById('originalCanvas');
const previewCanvas = document.getElementById('previewCanvas');
const downloadBtn = document.getElementById('downloadBtn');
const loadingMessage = document.getElementById('loadingMessage');
const errorMessage = document.getElementById('errorMessage');
const cropOverlay = document.getElementById('cropOverlay');

let currentImage = null; // 儲存當前加載的圖片元素
let originalCtx = originalCanvas.getContext('2d');
let previewCtx = previewCanvas.getContext('2d');
let faceDetectionModelLoaded = false;
let cropRect = { x: 0, y: 0, width: 0, height: 0 }; // 當前裁剪框的座標和尺寸

// --- 取得 GitHub Pages 的基底路徑 ---
function getBasePath() {
    // 獲取當前頁面的路徑名，例如 /your-repo-name/index.html
    const pathname = window.location.pathname;
    // 如果路徑名不為 / (根目錄)，則提取第一個子目錄作為基底路徑
    // 例如 /your-repo-name/ -> /your-repo-name
    // 例如 / -> ''
    const basePathMatch = pathname.match(/^\/([^\/]+)/);
    // 如果是像 "your-username.github.io" 這樣的根域名，basePath 會是空字串
    // 如果是 "your-username.github.io/your-repo-name/"，basePath 會是 "/your-repo-name"
    return basePathMatch ? basePathMatch[0] : '';
}

const MODELS_PATH = `${getBasePath()}/models`; // 動態設定模型路徑
console.log('模型將從此路徑載入:', MODELS_PATH);


// --- 載入 Face-API.js 模型 ---
async function loadModels() {
    loadingMessage.style.display = 'block';
    try {
        // 使用動態計算的 MODELS_PATH
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_PATH);
        faceDetectionModelLoaded = true;
        loadingMessage.style.display = 'none';
        console.log('Face-API.js 模型載入成功！');
    } catch (error) {
        loadingMessage.style.display = 'none';
        errorMessage.style.display = 'block';
        errorMessage.textContent = `模型載入失敗：${error.message}。請確認網路連線或 models 資料夾路徑是否正確 (${MODELS_PATH})。`;
        console.error('模型載入失敗:', error);
    }
}
loadModels();

// --- 圖片上傳處理 ---
imageUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    errorMessage.style.display = 'none';
    downloadBtn.style.display = 'none';
    cropOverlay.style.display = 'none'; // 隱藏裁剪框

    const reader = new FileReader();
    reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
            currentImage = img; // 儲存當前圖片
            drawOriginalImage(img);

            if (!faceDetectionModelLoaded) {
                errorMessage.style.display = 'block';
                errorMessage.textContent = 'Face-API.js 模型尚未載入。請稍後再試或檢查網路。';
                return;
            }

            // 偵測人臉
            try {
                const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options());

                if (detections.length > 0) {
                    // 取第一個偵測到的人臉作為基準
                    const faceBox = detections[0].box;
                    console.log('偵測到人臉:', faceBox);

                    // 計算初始裁剪區域 (胸部以上)
                    // 這裡是一個簡單的推斷邏輯：
                    // 向上延伸臉高的 0.75 倍 (確保頭頂空間)
                    // 向下延伸臉高的 1.5 倍 (包含胸部)
                    // 左右各延伸臉寬的 0.3 倍 (確保肩膀空間)
                    const initialCropX = Math.max(0, faceBox.x - faceBox.width * 0.3);
                    const initialCropY = Math.max(0, faceBox.y - faceBox.height * 0.75);
                    const initialCropWidth = Math.min(img.width - initialCropX, faceBox.width * (1 + 0.3 * 2)); // 臉寬 + 左右各延伸 0.3 倍臉寬
                    const initialCropHeight = Math.min(img.height - initialCropY, faceBox.height * (0.75 + 1 + 1.5)); // 0.75 (上) + 1 (臉) + 1.5 (下) = 3.25

                    // 確保裁剪框不超出圖片邊界
                    cropRect = {
                        x: initialCropX,
                        y: initialCropY,
                        width: initialCropWidth,
                        height: initialCropHeight
                    };

                    updateCropOverlay(); // 更新裁剪框的顯示
                    cropOverlay.style.display = 'block'; // 顯示裁剪框
                    updatePreview(); // 更新預覽
                    downloadBtn.style.display = 'block';

                } else {
                    errorMessage.style.display = 'block';
                    errorMessage.textContent = '未偵測到人像。請嘗試上傳另一張圖片。';
                    console.warn('未偵測到人臉。');
                    resetCanvas();
                }
            } catch (detectionError) {
                errorMessage.style.display = 'block';
                errorMessage.textContent = `人像偵測失敗：${detectionError.message}。`;
                console.error('人像偵測失敗:', detectionError);
                resetCanvas();
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

// --- 繪製原始圖片到 Canvas ---
function drawOriginalImage(img) {
    // 調整 canvas 大小以適應圖片，但避免過大
    const maxWidth = 500;
    const scaleFactor = Math.min(1, maxWidth / img.width);
    originalCanvas.width = img.width * scaleFactor;
    originalCanvas.height = img.height * scaleFactor;

    originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    originalCtx.drawImage(img, 0, 0, originalCanvas.width, originalCanvas.height);
}

// --- 更新裁剪框的視覺化疊加層 ---
function updateCropOverlay() {
    // 需要將圖片座標轉換為顯示在頁面上的 canvas 容器的相對座標
    const imgWidth = currentImage.width;
    const imgHeight = currentImage.height;
    const canvasWidth = originalCanvas.width;
    const canvasHeight = originalCanvas.height;

    const scaleX = canvasWidth / imgWidth;
    const scaleY = canvasHeight / imgHeight;

    // 將 cropRect 的原始圖片座標轉換為顯示座標
    const displayX = cropRect.x * scaleX;
    const displayY = cropRect.y * scaleY;
    const displayWidth = cropRect.width * scaleX;
    const displayHeight = cropRect.height * scaleY;

    cropOverlay.style.left = `${displayX}px`;
    cropOverlay.style.top = `${displayY}px`;
    cropOverlay.style.width = `${displayWidth}px`;
    cropOverlay.style.height = `${displayHeight}px`;
}

// --- 更新預覽 Canvas ---
function updatePreview() {
    if (!currentImage) return;

    // 設定預覽 Canvas 的尺寸，例如正方形的 300x300 像素
    const previewSize = 300;
    previewCanvas.width = previewSize;
    previewCanvas.height = previewSize;

    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    // 計算源圖片的裁剪區域與目標預覽區域的縮放比例
    const aspectRatio = cropRect.width / cropRect.height;
    let sx = cropRect.x;
    let sy = cropRect.y;
    let sWidth = cropRect.width;
    let sHeight = cropRect.height;

    let dx = 0;
    let dy = 0;
    let dWidth = previewCanvas.width;
    let dHeight = previewCanvas.height;

    // 調整源裁剪區域以適應目標預覽框的比例，進行「Cover」效果
    if (previewCanvas.width / previewCanvas.height > aspectRatio) {
        // 預覽框比裁剪區域寬，需要裁剪源的高度
        sHeight = sWidth / (previewCanvas.width / previewCanvas.height);
        sy = cropRect.y + (cropRect.height - sHeight) / 2;
    } else {
        // 預覽框比裁剪區域高，需要裁剪源的寬度
        sWidth = sHeight * (previewCanvas.width / previewCanvas.height);
        sx = cropRect.x + (cropRect.width - sWidth) / 2;
    }

    // 確保裁剪範圍在原始圖片內
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sWidth = Math.min(sWidth, currentImage.width - sx);
    sHeight = Math.min(sHeight, currentImage.height - sy);

    previewCtx.drawImage(
        currentImage,
        sx, sy, sWidth, sHeight, // 從原始圖片裁剪的區域
        dx, dy, dWidth, dHeight // 繪製到預覽 Canvas 的區域
    );
}

// --- 重設 Canvas 狀態 ---
function resetCanvas() {
    originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    originalCanvas.width = 0;
    originalCanvas.height = 0;
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    currentImage = null;
    cropOverlay.style.display = 'none';
    downloadBtn.style.display = 'none';
}

// --- 下載功能 ---
downloadBtn.addEventListener('click', () => {
    if (!currentImage || !cropRect.width || !cropRect.height) {
        alert('沒有可供下載的圖片。');
        return;
    }

    // 創建一個臨時 Canvas 用於最終輸出
    const finalCanvas = document.createElement('canvas');
    // 這裡可以設定最終輸出尺寸，例如 2 吋大頭照的像素尺寸 (例如 413x531 像素，或 300x300 正方形等)
    // 為了通用性，建議增加選項讓使用者選擇輸出尺寸和形狀
    // 這裡先以固定尺寸為例，您可以根據選定的尺寸來動態調整
    const outputWidth = 413; // 假設 2 吋標準寬度，約 3.5cm
    const outputHeight = 531; // 假設 2 吋標準高度，約 4.5cm

    finalCanvas.width = outputWidth;
    finalCanvas.height = outputHeight;
    const finalCtx = finalCanvas.getContext('2d');

    // 繪製裁剪後的區域到最終 Canvas
    // 與預覽邏輯類似，也要考慮源裁剪區域和目標輸出區域的比例適應
    let sx = cropRect.x;
    let sy = cropRect.y;
    let sWidth = cropRect.width;
    let sHeight = cropRect.height;

    // 重新計算裁剪區域的長寬比，因為 cropRect 可能已經被使用者調整過
    const currentCropAspectRatio = cropRect.width / cropRect.height;
    const outputAspectRatio = outputWidth / outputHeight;

    // 調整源裁剪區域以適應目標輸出框的比例，實現「Cover」效果
    if (outputAspectRatio > currentCropAspectRatio) {
        // 輸出框比裁剪區域寬，需要調整源裁剪的高度
        sHeight = sWidth / outputAspectRatio;
        sy = cropRect.y + (cropRect.height - sHeight) / 2;
    } else {
        // 輸出框比裁剪區域高，需要調整源裁剪的寬度
        sWidth = sHeight * outputAspectRatio;
        sx = cropRect.x + (cropRect.width - sWidth) / 2;
    }

    // 確保裁剪範圍在原始圖片內
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sWidth = Math.min(sWidth, currentImage.width - sx);
    sHeight = Math.min(sHeight, currentImage.height - sy);

    finalCtx.drawImage(
        currentImage,
        sx, sy, sWidth, sHeight,
        0, 0, finalCanvas.width, finalCanvas.height
    );

    // 如果是圓形輸出，則在這裡應用圓形遮罩 (範例，需要加入 UI 選擇)
    // finalCtx.save();
    // finalCtx.beginPath();
    // finalCtx.arc(finalCanvas.width / 2, finalCanvas.height / 2, Math.min(finalCanvas.width, finalCanvas.height) / 2, 0, Math.PI * 2, true);
    // finalCtx.closePath();
    // finalCtx.clip();
    // finalCtx.drawImage(currentImage, sx, sy, sWidth, sHeight, 0, 0, finalCanvas.width, finalCanvas.height); // 再次繪製圖片到剪裁後的圓形區域
    // finalCtx.restore();

    // 選擇輸出格式，這裡使用 PNG，也可以是 image/jpeg
    const dataURL = finalCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'cropped_photo.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});


// --- 實現裁剪框拖曳與縮放邏輯 ---
let isDragging = false;
let isResizing = false;
let activeHandle = null; // 儲存當前正在操作的手柄類型
let startMouseX, startMouseY; // 鼠標點擊時的頁面座標
let startCropX, startCropY, startCropWidth, startCropHeight; // 裁剪框開始拖曳/縮放時的尺寸

// 轉換螢幕座標到原始圖片像素座標的比例
let scaleX_displayToOriginal = 1;
let scaleY_displayToOriginal = 1;

cropOverlay.addEventListener('mousedown', (e) => {
    // 只有在左鍵點擊時才啟動拖曳/縮放
    if (e.button !== 0) return;

    // 更新轉換比例
    const originalCanvasRect = originalCanvas.getBoundingClientRect();
    scaleX_displayToOriginal = currentImage.width / originalCanvasRect.width;
    scaleY_displayToOriginal = currentImage.height / originalCanvasRect.height;

    // 判斷是否點擊到縮放手柄
    if (e.target.classList.contains('crop-handle')) {
        isResizing = true;
        activeHandle = e.target.classList[1]; // 例如 'top-left', 'bottom-right'
    } else {
        // 如果沒有點擊到手柄，就開始拖曳整個框
        isDragging = true;
    }

    startMouseX = e.clientX;
    startMouseY = e.clientY;

    // 儲存當前裁剪框的狀態（原始圖片像素座標）
    startCropX = cropRect.x;
    startCropY = cropRect.y;
    startCropWidth = cropRect.width;
    startCropHeight = cropRect.height;

    e.preventDefault(); // 防止圖片拖曳或文字選取
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging && !isResizing) return;

    // 將鼠標移動的螢幕距離轉換為原始圖片像素距離
    const dx = (e.clientX - startMouseX) * scaleX_displayToOriginal;
    const dy = (e.clientY - startMouseY) * scaleY_displayToOriginal;

    if (isDragging) {
        // --- 拖曳邏輯 ---
        let newX = startCropX + dx;
        let newY = startCropY + dy;

        // 限制裁剪框不超出圖片邊界
        newX = Math.max(0, Math.min(newX, currentImage.width - startCropWidth));
        newY = Math.max(0, Math.min(newY, currentImage.height - startCropHeight));

        cropRect.x = newX;
        cropRect.y = newY;

    } else if (isResizing) {
        // --- 縮放邏輯 ---
        let newX = startCropX;
        let newY = startCropY;
        let newWidth = startCropWidth;
        let newHeight = startCropHeight;

        const minSize = 50; // 裁剪框的最小尺寸，防止縮放到 0

        switch (activeHandle) {
            case 'top-left':
                newX = Math.min(startCropX + dx, startCropX + startCropWidth - minSize);
                newY = Math.min(startCropY + dy, startCropY + startCropHeight - minSize);
                newWidth = startCropWidth - (newX - startCropX);
                newHeight = startCropHeight - (newY - startCropY);
                break;
            case 'top-right':
                newWidth = Math.max(minSize, startCropWidth + dx);
                newY = Math.min(startCropY + dy, startCropY + startCropHeight - minSize);
                newHeight = startCropHeight - (newY - startCropY);
                break;
            case 'bottom-left':
                newX = Math.min(startCropX + dx, startCropX + startCropWidth - minSize);
                newWidth = startCropWidth - (newX - startCropX);
                newHeight = Math.max(minSize, startCropHeight + dy);
                break;
            case 'bottom-right':
                newWidth = Math.max(minSize, startCropWidth + dx);
                newHeight = Math.max(minSize, startCropHeight + dy);
                break;
        }

        // 限制裁剪框不超出原始圖片邊界
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);
        newWidth = Math.min(newWidth, currentImage.width - newX);
        newHeight = Math.min(newHeight, currentImage.height - newY);

        // 如果需要鎖定比例 (例如正方形或 2 吋比例)，在此處調整 newWidth/newHeight
        // 例如：假設我們有一個 'selectedOutputRatio' 變數 (例如 1 代表正方形，或 413/531 代表 2 吋)
        // if (selectedOutputRatio) {
        //     const currentRatio = newWidth / newHeight;
        //     if (Math.abs(currentRatio - selectedOutputRatio) > 0.01) {
        //         if (activeHandle.includes('left')) { // 如果是左邊手柄，調整 newX 和 newWidth
        //             newWidth = newHeight * selectedOutputRatio;
        //             newX = startCropX + startCropWidth - newWidth;
        //         } else { // 如果是右邊手柄，調整 newHeight
        //             newHeight = newWidth / selectedOutputRatio;
        //         }
        //     }
        // }


        cropRect.x = newX;
        cropRect.y = newY;
        cropRect.width = newWidth;
        cropRect.height = newHeight;
    }

    updateCropOverlay(); // 更新視覺化的裁剪框
    updatePreview(); // 更新預覽
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
    activeHandle = null;
});