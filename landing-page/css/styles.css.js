document.addEventListener('DOMContentLoaded', function() {
    const input = document.getElementById('barcodeInput');
    const status = document.getElementById('status');
    const scannerContainer = document.getElementById('scannerContainer');
    const responseModal = document.getElementById('responseModal');
    const modalMessage = document.getElementById('modalMessage');
    const responseLines = document.getElementById('responseLines');
    const closeModal = document.getElementById('closeModal');
    const errorCross = document.getElementById('errorCross');
    const speechSynthesis = window.speechSynthesis;
    let isProcessing = false;
    let inputTimeout = null;
    const WAIT_TIME = 100;

    function convertUrlsToLinks(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.replace(urlRegex, function(url) {
            return `<a href="${url}" target="_blank" class="clickable-link">לפרטים נוספים לחץ כאן</a>`;
        });
    }

    input.focus();

    function speakText(text) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'he-IL';
        utterance.pitch = 1.2;
        utterance.rate = 0.8;
        utterance.volume = 1;
        
        const voices = speechSynthesis.getVoices();
        const hebrewVoices = voices.filter(voice => voice.lang === 'he-IL');
        if (hebrewVoices.length > 0) {
            utterance.voice = hebrewVoices[0];
        }
        
        speechSynthesis.speak(utterance);
    }

    function showModal(message, lines, type, statusCode) {
        responseLines.innerHTML = '';

        lines.slice(0, -1).forEach(line => {
            const lineElement = document.createElement('div');
            lineElement.innerHTML = convertUrlsToLinks(line);
            lineElement.style.fontSize = '36px';
            responseLines.appendChild(lineElement);
        });

        if (statusCode === 200) {
            modalMessage.style.backgroundColor = '#e8f5e9';
            errorCross.style.display = 'none';
        } else if (statusCode === 400) {
            errorCross.style.display = 'block';
            modalMessage.style.backgroundColor = '#fef2f2';
        }

        modalMessage.innerHTML = convertUrlsToLinks(message);
        modalMessage.className = type;
        modalMessage.style.fontSize = '36px';
        responseModal.style.display = 'flex';

        speakText(lines[lines.length - 1]);

        setTimeout(() => {
            responseModal.style.display = 'none';
        }, 3000);
    }

    closeModal.onclick = function() {
        responseModal.style.display = 'none';
    }

    window.onclick = function(event) {
        if (event.target == responseModal) {
            responseModal.style.display = 'none';
        }
    }

    async function processBarcode(barcode) {
        if (isProcessing) return;
        
        isProcessing = true;
        scannerContainer.classList.add('scanning');
        input.classList.remove('waiting');

        try {
            const response = await fetch('https://hook.us2.make.com/w3alokpqs2oab0p75h32ufqs9y23ijwh?gender=נכנס לפני הזמן', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ barcode })
            });

            const result = await response.text();
            const lines = result.split('\n');

            if (response.ok) {
                const successMessage = 'הברקוד נסרק בהצלחה: ' + barcode;
                showStatus(result, 'success');
                showModal(lines[lines.length - 1], lines, 'success', response.status);
            } else {
                const errorMessage = 'שגיאה בסריקה: ' + result;
                showStatus(errorMessage, 'error');
                showModal(lines[lines.length - 1], lines, 'error', response.status);
            }
        } catch (error) {
            const errorMessage = 'שגיאה בתקשורת עם השרת: ' + error.message;
            showStatus(errorMessage, 'error');
            showModal(error.message, [error.message], 'error', 500);
        }

        setTimeout(() => {
            input.value = '';
            scannerContainer.classList.remove('scanning');
            isProcessing = false;
            input.focus();
        }, 1000);
    }

    input.addEventListener('input', function(e) {
        input.classList.add('waiting');
        
        if (inputTimeout) {
            clearTimeout(inputTimeout);
        }

        inputTimeout = setTimeout(() => {
            const barcode = e.target.value;
            if (barcode.length > 0) {
                processBarcode(barcode);
            }
        }, WAIT_TIME);
    });

    document.addEventListener('click', function() {
        input.focus();
    });

    function showStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type}`;
        status.style.display = 'block';
    }
});
