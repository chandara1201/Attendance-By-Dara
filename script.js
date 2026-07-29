    let students = JSON.parse(localStorage.getItem('students')) || [];
    let records = JSON.parse(localStorage.getItem('records')) || [];

    let dailyChartInstance = null;
    let monthlyChartInstance = null;
    let reminderCheckInterval = null;

    let adminPassword = localStorage.getItem('admin_pwd') || "1234";
    let isReadOnly = true;

    function showToast(message) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        container.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function playBeep(frequency = 880, type = 'sine', duration = 0.15) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = frequency;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
            osc.stop(ctx.currentTime + duration);
        } catch(e) {}
    }

    const savedTheme = localStorage.getItem('app_theme') || 'theme-hacker';
    document.body.className = savedTheme;
    document.querySelector('.theme-select').value = savedTheme;

    function changeAppTheme(themeName) {
        document.body.className = themeName;
        localStorage.setItem('app_theme', themeName);
        updateDashboard();
        generateMonthlyReport();
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthStr = todayStr.substring(0, 7);
    document.getElementById('attDate').value = todayStr;
    document.getElementById('reportDate').value = todayStr;
    document.getElementById('reportMonth').value = currentMonthStr;

    function calculateStatusFromTime(timeString) {
        if (!timeString) return 'P';
        const [h, m] = timeString.split(':').map(Number);
        if (h < 7 || (h === 7 && m <= 40)) return 'P';
        if (h === 7 || (h === 8 && m <= 30)) return 'L';
        return 'A';
    }

    function getScheduledTimeOut(student, dateString) {
        if (!student.schedule) return '03:00';
        
        const date = new Date(dateString);
        const dayOfWeek = date.getDay(); 

        if (student.schedule.specialDays && student.schedule.specialDays.includes(dayOfWeek.toString())) {
            return student.schedule.specialTimeOut || '23:00';
        }
        return student.schedule.defaultTimeOut || '03:00';
    }

    function showStudentQR(studentId, name) {
        const modal = document.getElementById('qrModal');
        const canvasDiv = document.getElementById('qrcodeCanvas');
        const title = document.getElementById('qrModalTitle');
        const sub = document.getElementById('qrModalSub');

        canvasDiv.innerHTML = "";
        title.innerText = name;
        sub.innerText = `អត្តលេខបុគ្គលិក៖ #${studentId}`;

        new QRCode(canvasDiv, {
            text: String(studentId),
            width: 150,
            height: 150,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });

        modal.style.display = 'flex';
    }

    function closeQRModal() {
        document.getElementById('qrModal').style.display = 'none';
    }

    let html5QrScanner = null;

    function openQRScanner() {
        if (isReadOnly) return;
        if (typeof Html5Qrcode === 'undefined') {
            showToast('⚠️ មិនអាចផ្ទុកកម្មវិធីស្កែន QR បានទេ (គ្មានអ៊ីនធឺណិត)');
            return;
        }
        const modal = document.getElementById('qrScannerModal');
        const statusEl = document.getElementById('qrScanStatus');
        modal.style.display = 'flex';
        statusEl.innerText = 'កំពុងបើកម៉ាស៊ីនថត...';

        html5QrScanner = new Html5Qrcode("qrReaderBox");
        html5QrScanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            onQRScanSuccess,
            () => {}
        ).then(() => {
            statusEl.innerText = 'សូមតម្រង់ QR Code របស់បុគ្គលិកមកកាមេរ៉ា';
        }).catch(() => {
            statusEl.innerText = '❌ មិនអាចចូលប្រើកាមេរ៉ាបានទេ។ សូមអនុញ្ញាតសិទ្ធិកាមេរ៉ា។';
        });
    }

    function closeQRScanner() {
        const modal = document.getElementById('qrScannerModal');
        if (html5QrScanner) {
            html5QrScanner.stop().then(() => {
                html5QrScanner.clear();
                html5QrScanner = null;
            }).catch(() => { html5QrScanner = null; });
        }
        modal.style.display = 'none';
    }

    function onQRScanSuccess(decodedText) {
        const statusEl = document.getElementById('qrScanStatus');
        const studentId = parseInt(decodedText.trim());
        const student = students.find(s => s.id === studentId);

        if (!student) {
            statusEl.innerText = `❌ រកមិនឃើញបុគ្គលិកលេខ ID #${decodedText}`;
            playBeep(300, 'square', 0.2);
            return;
        }

        const date = document.getElementById('attDate').value;
        const now = new Date();
        const timeIn = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        const status = calculateStatusFromTime(timeIn);
        const timeOut = getScheduledTimeOut(student, date);

        const index = records.findIndex(r => r.date === date && r.studentId === studentId);
        if (index !== -1) {
            records[index] = { date, studentId, status, timeIn, timeOut: records[index].timeOut || timeOut };
        } else {
            records.push({ date, studentId, status, timeIn, timeOut });
        }

        saveData();
        playBeep(1000, 'sine', 0.15);
        statusEl.innerText = `✅ បានកត់ត្រា៖ ${student.name} (${timeIn})`;
        renderMarkArea();
        generateReport();
    }

    function handleManualTimeChange(studentId) {
        const timeInVal = document.getElementById(`timeIn-${studentId}`)?.value;
        const statusSelect = document.getElementById(`status-${studentId}`);
        if (timeInVal && statusSelect) {
            statusSelect.value = calculateStatusFromTime(timeInVal);
        }
    }

    function markAllStatus(statusCode) {
        if (isReadOnly) return;
        const selects = document.querySelectorAll('[id^="status-"]');
        selects.forEach(select => select.value = statusCode);
        showToast(`បានកំណត់ទាំងអស់ទៅជា ${statusCode === 'P' ? 'វត្តមាន (Present)' : 'អវត្តមាន (Absent)'}`);
    }

    function backupSystemData() {
        const exportData = {
            students: students,
            records: records,
            exportDate: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Attendance_Backup_${todayStr}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function restoreSystemData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                if (imported.students && imported.records) {
                    students = imported.students;
                    records = imported.records;
                    saveData();
                    renderStudents();
                    renderMarkArea();
                    generateReport();
                    generateMonthlyReport();
                    updateHistoryDropdown();
                    showToast("✅ នាំចូល Backup រក្សាទុកជោគជ័យ!");
                } else {
                    showToast("⚠️ ទម្រង់ឯកសារ Backup មិនត្រឹមត្រូវ!");
                }
            } catch (err) {
                showToast("❌ មានបញ្ហាក្នុងការអានឯកសារ JSON");
            }
        };
        reader.readAsText(file);
    }

    function requestNotificationPermission() {
        if (!("Notification" in window)) {
            showToast("⚠️ កម្មវិធីត្រួតពិនិត្យរបស់អ្នកមិនគាំទ្រ Notification ទេ។");
            return;
        }

        Notification.requestPermission().then(permission => {
            const btn = document.getElementById('btnNotifPermission');
            if (permission === "granted") {
                btn.innerText = "🔔 ជូនដំណឹង៖ បើក";
                btn.style.borderColor = "var(--primary)";
                sendBrowserNotification("✅ ប្រព័ន្ធបានកំណត់ការជូនដំណឹងជោគជ័យ!", "អ្នកនឹងទទួលបានការរំលឹកកត់ត្រាវត្តមានជាស្វ័យប្រវត្តិ។");
            } else {
                btn.innerText = "🔕 ជូនដំណឹង៖ បិទ";
                btn.style.borderColor = "var(--danger)";
            }
        });
    }

    function sendBrowserNotification(title, bodyText) {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, {
                body: bodyText,
                icon: "https://cdn-icons-png.flaticon.com/512/3602/3602145.png"
            });
        }
    }

    function saveReminderConfig() {
        const timeVal = document.getElementById('reminderTime').value;
        const toggleVal = document.getElementById('reminderToggle').value;
        const thresholdVal = document.getElementById('absenceThreshold')?.value || '3';

        localStorage.setItem('reminder_time', timeVal);
        localStorage.setItem('reminder_toggle', toggleVal);
        localStorage.setItem('absence_threshold', thresholdVal);

        startReminderChecker();
    }

    function loadReminderConfig() {
        const savedTime = localStorage.getItem('reminder_time') || "08:00";
        const savedToggle = localStorage.getItem('reminder_toggle') || "OFF";
        const savedThreshold = localStorage.getItem('absence_threshold') || "3";

        document.getElementById('reminderTime').value = savedTime;
        document.getElementById('reminderToggle').value = savedToggle;
        if (document.getElementById('absenceThreshold')) {
            document.getElementById('absenceThreshold').value = savedThreshold;
        }

        startReminderChecker();
    }

    function checkAbsenceThresholds() {
        const threshold = parseInt(localStorage.getItem('absence_threshold') || '3');
        const monthStr = new Date().toISOString().substring(0, 7);
        const monthRecords = records.filter(r => r.date.startsWith(monthStr));

        students.forEach(s => {
            const absentCount = monthRecords.filter(r => r.studentId === s.id && r.status === 'A').length;
            const alertKey = `absence_alerted_${s.id}_${monthStr}`;

            if (absentCount >= threshold && !sessionStorage.getItem(alertKey)) {
                showToast(`⚠️ ${s.name} (#${s.id}) បានអវត្តមាន ${absentCount} ដងក្នុងខែនេះ!`);
                sendBrowserNotification("⚠️ ការជូនដំណឹងអវត្តមានលើសកំណត់", `${s.name} បានអវត្តមាន ${absentCount} ដងក្នុងខែនេះ។`);
                sessionStorage.setItem(alertKey, '1');
            }
        });
    }

    function startReminderChecker() {
        if (reminderCheckInterval) clearInterval(reminderCheckInterval);

        const toggleVal = localStorage.getItem('reminder_toggle') || "OFF";
        if (toggleVal !== "ON") return;

        reminderCheckInterval = setInterval(() => {
            const now = new Date();
            const currentHHMM = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');
            const targetHHMM = localStorage.getItem('reminder_time') || "08:00";
            const lastNotifiedDate = localStorage.getItem('last_reminder_date');

            if (currentHHMM === targetHHMM && lastNotifiedDate !== todayStr) {
                sendBrowserNotification("⏰ ការរំលឹកវត្តមានប្រចាំថ្ងៃ!", "ដល់ម៉ោងត្រូវកត់ត្រាវត្តមានសមាជិក/សិស្សហើយ។");
                localStorage.setItem('last_reminder_date', todayStr);
            }
        }, 30000);
    }

    function toggleViewMode() {
        if (isReadOnly) {
            const pwd = prompt("🔑 សូមបញ្ចូលលេខកូដសម្ងាត់ ADMIN (PASSCODE)៖");
            if (pwd === adminPassword) {
                isReadOnly = false;
                showToast("✅ អនុញ្ញាត៖ បានចូលប្រើប្រាស់ ADMIN MODE");
                applyViewMode();
            } else if (pwd !== null) {
                showToast("❌ បដិសេធ៖ លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!");
            }
        } else {
            isReadOnly = true;
            showToast("🔒 បានចាកចេញពី ADMIN MODE");
            applyViewMode();
        }
    }

    function changeAdminPassword() {
        if (isReadOnly) return;
        const currentPwd = prompt("🔑 សូមបញ្ចូលលេខកូដសម្ងាត់ចាស់៖");
        if (currentPwd === adminPassword) {
            const newPwd = prompt("✨ សូមបញ្ចូលលេខកូដសម្ងាត់ថ្មី៖");
            if (newPwd && newPwd.trim() !== "") {
                adminPassword = newPwd.trim();
                localStorage.setItem('admin_pwd', adminPassword);
                showToast("✅ បច្ចុប្បន្នភាពលេខកូដសម្ងាត់ជោគជ័យ!");
            } else {
                showToast("❌ លេខកូដសម្ងាត់មិនអាចទទេបានទេ!");
            }
        } else if (currentPwd !== null) {
            showToast("❌ លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!");
        }
    }

    function clearAllAttendance() {
        if (isReadOnly) return;
        if (confirm("⚠️ ប្រយ័ត្ន៖ សកម្មភាពនេះនឹងលុបទិន្នន័យវត្តមានទាំងអស់! តើអ្នកពិតជាចង់បន្ត?")) {
            records = [];
            saveData();
            renderMarkArea();
            generateReport();
            generateMonthlyReport();
            viewStudentHistory();
            showToast("✅ បានលុបទិន្នន័យទាំងអស់រួចរាល់!");
        }
    }

    function applyViewMode() {
        const btn = document.getElementById('modeSwitchBtn');
        const banner = document.getElementById('viewModeBanner');
        const adminCards = document.querySelectorAll('.admin-only');
        const adminBtns = document.querySelectorAll('.admin-only-btn');

        if (isReadOnly) {
            btn.innerText = "[!] មើលតែប៉ុណ្ណោះ";
            banner.style.display = "flex";

            adminCards.forEach(c => c.style.display = 'none');
            adminBtns.forEach(b => b.style.display = 'none');
        } else {
            btn.innerText = "[🔒] របៀប ADMIN";
            banner.style.display = "none";

            adminCards.forEach(c => c.style.display = 'block');
            adminBtns.forEach(b => b.style.display = 'inline-flex');
        }

        renderStudents();
        renderMarkArea();
    }

    function setToday(inputId) {
        document.getElementById(inputId).value = new Date().toISOString().split('T')[0];
        if (inputId === 'attDate') renderMarkArea();
        if (inputId === 'reportDate') generateReport();
    }

    function shiftDate(inputId, days) {
        const input = document.getElementById(inputId);
        const current = new Date(input.value || Date.now());
        current.setDate(current.getDate() + days);
        input.value = current.toISOString().split('T')[0];
        if (inputId === 'attDate') renderMarkArea();
        if (inputId === 'reportDate') generateReport();
    }

    function saveData() {
        if (isReadOnly) return;
        localStorage.setItem('students', JSON.stringify(students));
        localStorage.setItem('records', JSON.stringify(records));
        updateCSVArea();
        updateDashboard();
        generateMonthlyReport();
    }

    function addOrEditStudent() {
        if (isReadOnly) return;
        const id = parseInt(document.getElementById('stdId').value);
        const name = document.getElementById('stdName').value.trim();
        const parentName = document.getElementById('stdParentName')?.value.trim() || '';
        const parentPhone = document.getElementById('stdParentPhone')?.value.trim() || '';
        const defaultTimeOut = document.getElementById('stdDefaultTimeOut').value;
        const specialTimeOut = document.getElementById('stdSpecialTimeOut').value;

        const specialDays = Array.from(document.querySelectorAll('.special-day:checked')).map(cb => cb.value);

        if (!id || !name) {
            showToast('សូមបំពេញព័ត៌មានដែលខ្វះ!');
            return;
        }

        const schedule = { defaultTimeOut, specialTimeOut, specialDays };

        const existing = students.find(s => s.id === id);
        if (existing) {
            existing.name = name;
            existing.schedule = schedule;
            existing.parentName = parentName;
            existing.parentPhone = parentPhone;
            showToast('បានធ្វើបច្ចុប្បន្នភាពទិន្នន័យបុគ្គលិក!');
        } else {
            students.push({ id, name, schedule, parentName, parentPhone });
            showToast('បានបន្ថែមបុគ្គលិកថ្មីទៅក្នុងប្រព័ន្ធ!');
        }

        document.getElementById('stdId').value = '';
        document.getElementById('stdName').value = '';
        document.getElementById('stdParentName').value = '';
        document.getElementById('stdParentPhone').value = '';
        document.querySelectorAll('.special-day').forEach(cb => cb.checked = false);

        saveData();
        renderStudents();
        renderMarkArea();
        generateReport();
        updateHistoryDropdown();
    }

    function importStudentsFromCSV() {
        if (isReadOnly) return;
        const fileInput = document.getElementById('csvFileInput');
        const file = fileInput.files[0];

        if (!file) {
            showToast('មិនទាន់បានជ្រើសរើសឯកសារ CSV ទេ!');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            const lines = text.split('\n');
            let addedCount = 0;

            lines.forEach((line, idx) => {
                if (idx === 0 || !line.trim()) return;
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const id = parseInt(parts[0].trim());
                    const name = parts[1].replace(/"/g, '').trim();
                    const parentName = (parts[2] || '').replace(/"/g, '').trim();
                    const parentPhone = (parts[3] || '').replace(/"/g, '').trim();

                    if (id && name && !students.some(s => s.id === id)) {
                        students.push({ 
                            id, 
                            name, 
                            parentName,
                            parentPhone,
                            schedule: { defaultTimeOut: "03:00", specialTimeOut: "23:00", specialDays: [] } 
                        });
                        addedCount++;
                    }
                }
            });

            saveData();
            renderStudents();
            renderMarkArea();
            updateHistoryDropdown();
            showToast(`ជោគជ័យ៖ បាននាំចូលបុគ្គលិកចំនួន ${addedCount} នាក់`);
            fileInput.value = '';
        };
        reader.readAsText(file);
    }

    function importAttendanceFromCSV() {
        if (isReadOnly) return;
        const fileInput = document.getElementById('csvAttendanceInput');
        const file = fileInput.files[0];

        if (!file) {
            showToast('មិនទាន់បានជ្រើសរើសឯកសារ CSV ទេ!');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            const lines = text.split('\n');
            let addedCount = 0, updatedCount = 0;

            lines.forEach((line, idx) => {
                if (idx === 0 || !line.trim()) return;
                const parts = line.split(',');
                if (parts.length >= 3) {
                    const date = parts[0].trim();
                    const studentId = parseInt(parts[1].trim());
                    let status = parts[2].trim().toUpperCase();
                    const timeIn = (parts[3] || '').trim();
                    const timeOut = (parts[4] || '').trim();

                    if (!['P','L','A','V'].includes(status)) status = 'P';
                    if (!date || !studentId) return;

                    const index = records.findIndex(r => r.date === date && r.studentId === studentId);
                    if (index !== -1) {
                        records[index] = { date, studentId, status, timeIn, timeOut };
                        updatedCount++;
                    } else {
                        records.push({ date, studentId, status, timeIn, timeOut });
                        addedCount++;
                    }
                }
            });

            saveData();
            renderMarkArea();
            generateReport();
            generateMonthlyReport();
            viewStudentHistory();
            checkAbsenceThresholds();
            showToast(`ជោគជ័យ៖ បន្ថែម ${addedCount} កត់ត្រាថ្មី, ធ្វើបច្ចុប្បន្នភាព ${updatedCount}`);
            fileInput.value = '';
        };
        reader.readAsText(file);
    }

    function editStudent(id) {
        if (isReadOnly) return;
        const student = students.find(s => s.id === id);
        if (student) {
            document.getElementById('stdId').value = student.id;
            document.getElementById('stdName').value = student.name;
            document.getElementById('stdParentName').value = student.parentName || '';
            document.getElementById('stdParentPhone').value = student.parentPhone || '';

            if (student.schedule) {
                document.getElementById('stdDefaultTimeOut').value = student.schedule.defaultTimeOut || '03:00';
                document.getElementById('stdSpecialTimeOut').value = student.schedule.specialTimeOut || '23:00';
                document.querySelectorAll('.special-day').forEach(cb => {
                    cb.checked = student.schedule.specialDays && student.schedule.specialDays.includes(cb.value);
                });
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function deleteStudent(id) {
        if (isReadOnly) return;
        if (confirm('តើអ្នកពិតជាចង់លុបបុគ្គលិកនេះមែនទេ?')) {
            students = students.filter(s => s.id !== id);
            records = records.filter(r => r.studentId !== id);
            saveData();
            renderStudents();
            renderMarkArea();
            generateReport();
            updateHistoryDropdown();
            document.getElementById('historyResult').innerHTML = '';
            showToast('បានលុบบុគ្គលិករួចរាល់!');
        }
    }

    function renderStudents() {
        const list = document.getElementById('studentList');
        if (!list) return;
        const query = document.getElementById('searchStudent')?.value.toLowerCase() || '';

        if (students.length === 0) {
            list.innerHTML = '<small style="color:var(--text-muted);">រកមិនឃើញទិន្នន័យ។</small>';
            return;
        }

        students.sort((a, b) => a.id - b.id);
        const filtered = students.filter(s => s.id.toString().includes(query) || s.name.toLowerCase().includes(query));

        let tableHTML = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>ឈ្មោះបុគ្គលិក</th>
                        <th>ប័ណ្ណ / QR</th>
                        ${!isReadOnly ? '<th style="width: 120px;">សកម្មភាព</th>' : ''}
                    </tr>
                </thead>
                <tbody>
        `;

        filtered.forEach(s => {
            tableHTML += `
                <tr>
                    <td><b>#${s.id}</b></td>
                    <td>${s.name}</td>
                    <td>
                        <button class="btn-small btn-download" onclick="showStudentQR(${s.id}, '${s.name}')">📱 មើល QR Code</button>
                    </td>
                    ${!isReadOnly ? `
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn-small btn-edit" onclick="editStudent(${s.id})">កែប្រែ</button>
                            <button class="btn-small btn-danger" onclick="deleteStudent(${s.id})">លុប</button>
                        </div>
                    </td>` : ''}
                </tr>
            `;
        });

        tableHTML += '</tbody></table>';
        list.innerHTML = tableHTML;
    }

    // [រក្សាកូដ JavaScript ដើមរបស់អ្នកទាំងអស់តាម...]

// មុខងារត្រួតពិនិត្យថ្ងៃពិសេស
function isSpecialDay(student, dateString) {
    if (!student.schedule || !student.schedule.specialDays) return false;
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    return student.schedule.specialDays.includes(dayOfWeek.toString());
}

// កែសម្រួល Function renderMarkArea ឱ្យគាំទ្រពណ៌ថ្ងៃពិសេស
function renderMarkArea() {
    const date = document.getElementById('attDate').value;
    const area = document.getElementById('markArea');
    area.innerHTML = '';

    students.forEach(s => {
        const isSpecial = isSpecialDay(s, date); 
        const specialClass = isSpecial ? 'name-special-day' : '';
        
        const div = document.createElement('div');
        div.className = 'student-row';
        div.innerHTML = `
            <div class="student-header ${specialClass}">
                ${s.name} ${isSpecial ? '⭐' : ''} [ID: #${s.id}]
            </div>
            <!-- បន្តកូដបញ្ចូល Select និង Input របស់អ្នកដូចដើម -->
        `;
        area.appendChild(div);
    });
}

// [រក្សាកូដ JavaScript ផ្សេងៗទៀត...]

    document.getElementById('attDate').addEventListener('change', renderMarkArea);

    function saveAttendance() {
        if (isReadOnly) return;
        const date = document.getElementById('attDate').value;

        students.forEach(s => {
            const statusElem = document.getElementById(`status-${s.id}`);
            if (!statusElem) return;

            const status = statusElem.value;
            const timeIn = document.getElementById(`timeIn-${s.id}`).value;
            const timeOut = document.getElementById(`timeOut-${s.id}`).value;

            const index = records.findIndex(r => r.date === date && r.studentId === s.id);

            if (index !== -1) {
                records[index] = { date, studentId: s.id, status, timeIn, timeOut };
            } else {
                records.push({ date, studentId: s.id, status, timeIn, timeOut });
            }
        });

        playBeep(900, 'sine', 0.2);
        saveData();
        showToast('បានរក្សាទុកវត្តមានសម្រាប់កាលបរិច្ឆេទ៖ ' + date);
        generateReport();
        viewStudentHistory();
    }

    function generateReportText() {
        const date = document.getElementById('reportDate').value;
        const dayRecords = records.filter(r => r.date === date);

        if (dayRecords.length === 0) {
            return "> មិនមានទិន្នន័យសម្រាប់ថ្ងៃទី៖ " + date;
        }

        let presentList = [];
        let absentList = [];
        let lateCount = 0;
        let leaveCount = 0;

        dayRecords.forEach(r => {
            const student = students.find(s => s.id === r.studentId);
            const name = student ? student.name : "មិនស្គាល់ឈ្មោះ";

            let times = '';
            if (r.timeIn || r.timeOut) {
                times = ` (${r.timeIn || '--:--'} -> ${r.timeOut || '--:--'})`;
            }

            if (r.status === 'P') {
                presentList.push({ name, info: times });
            } else if (r.status === 'L') {
                presentList.push({ name, info: ` ${times} (យឺត)` });
                lateCount++;
            } else if (r.status === 'A') {
                absentList.push({ name, info: '' });
            } else if (r.status === 'V') {
                absentList.push({ name, info: ' (ច្បាប់)' });
                leaveCount++;
            }
        });

        const totalAbsent = absentList.length;

        let text = `[របាយការណ៍វត្តមានប្រចាំថ្ងៃ]\n`;
        text += `កាលបរិច្ឆេទ : ${date}\n`;
        text += `វត្តមានសរុប : ${presentList.length}   យឺត : ${lateCount}\n-----------------------------------\n`;

        presentList.forEach((st, idx) => {
            text += `${idx + 1}. ${st.name}${st.info}\n`;
        });

        text += `\nអវត្តមានសរុប : ${totalAbsent}   ច្បាប់ : ${leaveCount}\n-----------------------------------\n`;

        absentList.forEach((st, idx) => {
            text += `${idx + 1}. ${st.name}${st.info}\n`;
        });

        text += `\n[បញ្ចប់របាយការណ៍]`;
        return text;
    }

    function generateReport() {
        const box = document.getElementById('reportBox');
        box.textContent = generateReportText();
        updateCSVArea();
    }

    function generateMonthlyReport() {
        const monthVal = document.getElementById('reportMonth').value;
        const area = document.getElementById('monthlyTableArea');

        if (!monthVal) {
            area.innerHTML = '<small style="color:gray;">សូមជ្រើសរើសខែ។</small>';
            return;
        }

        if (students.length === 0) {
            area.innerHTML = '<small style="color:gray;">មិនមានទិន្នន័យ។</small>';
            return;
        }

        const monthRecords = records.filter(r => r.date.startsWith(monthVal));

        let tableHTML = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>ឈ្មោះ</th>
                        <th style="color:var(--primary);">វត្តមាន</th>
                        <th style="color:var(--warning);">យឺត</th>
                        <th style="color:var(--danger);">អវត្តមាន</th>
                        <th style="color:var(--secondary);">ច្បាប់</th>
                    </tr>
                </thead>
                <tbody>
        `;

        students.sort((a, b) => a.id - b.id);

        students.forEach(s => {
            const sRecs = monthRecords.filter(r => r.studentId === s.id);
            let p = 0, l = 0, a = 0, v = 0;

            sRecs.forEach(r => {
                if (r.status === 'P') p++;
                if (r.status === 'L') l++;
                if (r.status === 'A') a++;
                if (r.status === 'V') v++;
            });

            tableHTML += `
                <tr>
                    <td><b>#${s.id}</b></td>
                    <td>${s.name}</td>
                    <td><b>${p}</b></td>
                    <td><b>${l}</b></td>
                    <td><b>${a}</b></td>
                    <td><b>${v}</b></td>
                </tr>
            `;
        });

        tableHTML += '</tbody></table>';
        area.innerHTML = tableHTML;

        renderMonthlyBarChart(monthVal, monthRecords);
        renderLeaderboard(monthVal, monthRecords);
    }

    function renderLeaderboard(monthVal, monthRecords) {
        const area = document.getElementById('leaderboardArea');
        if (!area) return;

        if (!monthVal || students.length === 0) {
            area.innerHTML = '<small style="color:gray;">មិនមានទិន្នន័យសម្រាប់បង្ហាញចំណាត់ថ្នាក់។</small>';
            return;
        }

        const ranking = students.map(s => {
            const sRecs = monthRecords.filter(r => r.studentId === s.id);
            let p = 0, l = 0, a = 0, v = 0;
            sRecs.forEach(r => {
                if (r.status === 'P') p++;
                if (r.status === 'L') l++;
                if (r.status === 'A') a++;
                if (r.status === 'V') v++;
            });
            const total = sRecs.length;
            const rate = total > 0 ? Math.round(((p + l) / total) * 100) : 0;
            return { id: s.id, name: s.name, present: p, late: l, absent: a, leave: v, total, rate };
        }).filter(r => r.total > 0);

        ranking.sort((a, b) => b.rate - a.rate || b.present - a.present);

        if (ranking.length === 0) {
            area.innerHTML = '<small style="color:gray;">មិនទាន់មានកត់ត្រាវត្តមានសម្រាប់ខែនេះទេ។</small>';
            return;
        }

        const medals = ['🥇', '🥈', '🥉'];
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>ចំណាត់ថ្នាក់</th>
                        <th>ឈ្មោះ</th>
                        <th>អត្រាវត្តមាន</th>
                        <th>ថ្ងៃវត្តមាន</th>
                    </tr>
                </thead>
                <tbody>
        `;

        ranking.forEach((r, idx) => {
            const rankLabel = medals[idx] || `#${idx + 1}`;
            html += `
                <tr>
                    <td><b>${rankLabel}</b></td>
                    <td>${r.name} <small style="opacity:0.6;">(#${r.id})</small></td>
                    <td><b style="color:var(--primary);">${r.rate}%</b></td>
                    <td>${r.present + r.late} / ${r.total}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        area.innerHTML = html;
    }

    function downloadMonthlyCSV() {
        const monthVal = document.getElementById('reportMonth').value;
        if (!monthVal) return;

        const monthRecords = records.filter(r => r.date.startsWith(monthVal));
        let csv = `\uFEFFMonthly Attendance Summary (${monthVal})\nID,Student Name,Present,Late,Absent,Leave\n`;

        students.sort((a, b) => a.id - b.id);
        students.forEach(s => {
            const sRecs = monthRecords.filter(r => r.studentId === s.id);
            let p = 0, l = 0, a = 0, v = 0;
            sRecs.forEach(r => {
                if (r.status === 'P') p++;
                if (r.status === 'L') l++;
                if (r.status === 'A') a++;
                if (r.status === 'V') v++;
            });
            csv += `${s.id},"${s.name}",${p},${l},${a},${v}\n`;
        });

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Monthly_Report_${monthVal}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function exportDailyReportPDF() {
        if (typeof window.jspdf === 'undefined') {
            showToast('⚠️ មិនអាចផ្ទុកកម្មវិធី PDF បានទេ (គ្មានអ៊ីនធឺណិត)');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const date = document.getElementById('reportDate').value;
        const reportText = generateReportText();

        doc.setFontSize(14);
        doc.text(`Daily Attendance Report - ${date}`, 14, 18);
        doc.setFontSize(10);

        const lines = doc.splitTextToSize(reportText, 180);
        doc.text(lines, 14, 30);

        doc.save(`Attendance_Report_${date}.pdf`);
        showToast('✅ បានទាញយករបាយការណ៍ជា PDF!');
    }

    function exportMonthlyReportPDF() {
        if (typeof window.jspdf === 'undefined') {
            showToast('⚠️ មិនអាចផ្ទុកកម្មវិធី PDF បានទេ (គ្មានអ៊ីនធឺណិត)');
            return;
        }
        const monthVal = document.getElementById('reportMonth').value;
        if (!monthVal) return;

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const monthRecords = records.filter(r => r.date.startsWith(monthVal));

        doc.setFontSize(14);
        doc.text(`Monthly Attendance Summary - ${monthVal}`, 14, 18);
        doc.setFontSize(9);

        let y = 30;
        doc.text("ID", 14, y);
        doc.text("Name", 30, y);
        doc.text("Present", 110, y);
        doc.text("Late", 135, y);
        doc.text("Absent", 155, y);
        doc.text("Leave", 178, y);
        y += 6;

        const sortedStudents = [...students].sort((a, b) => a.id - b.id);
        sortedStudents.forEach(s => {
            const sRecs = monthRecords.filter(r => r.studentId === s.id);
            let p = 0, l = 0, a = 0, v = 0;
            sRecs.forEach(r => {
                if (r.status === 'P') p++;
                if (r.status === 'L') l++;
                if (r.status === 'A') a++;
                if (r.status === 'V') v++;
            });

            if (y > 280) { doc.addPage(); y = 20; }
            doc.text(String(s.id), 14, y);
            doc.text(s.name, 30, y);
            doc.text(String(p), 115, y);
            doc.text(String(l), 138, y);
            doc.text(String(a), 158, y);
            doc.text(String(v), 180, y);
            y += 6;
        });

        doc.save(`Monthly_Report_${monthVal}.pdf`);
        showToast('✅ បានទាញយករបាយការណ៍ប្រចាំខែជា PDF!');
    }

    function saveTextFile() {
        const reportText = generateReportText();
        const date = document.getElementById('reportDate').value;
        
        const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Attendance_${date}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function generateCSVText() {
        let text = "\uFEFFDate,Student ID,Student Name,Status,Time In,Time Out\n";
        if (records.length === 0) return text;

        records.sort((a, b) => a.date.localeCompare(b.date) || a.studentId - b.studentId);

        records.forEach(r => {
            const student = students.find(s => s.id === r.studentId);
            const name = student ? student.name : "Unknown";
            let statusName = "Present";
            if (r.status === 'L') statusName = "Late";
            if (r.status === 'A') statusName = "Absent";
            if (r.status === 'V') statusName = "Leave";

            text += `${r.date},${r.studentId},"${name}",${statusName},${r.timeIn || ''},${r.timeOut || ''}\n`;
        });
        return text;
    }

    function updateCSVArea() {
        document.getElementById('csvArea').value = generateCSVText();
    }

    function downloadCSVFile() {
        const csvText = generateCSVText();
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "attendance_records.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function copyCSV() {
        const text = generateCSVText();
        navigator.clipboard.writeText(text).then(() => {
            showToast("បានចម្លងទិន្នន័យ CSV រួចរាល់!");
        }).catch(() => {
            const csvArea = document.getElementById('csvArea');
            csvArea.select();
            showToast("ទិន្នន័យត្រូវបានជ្រើសរើស!");
        });
    }

    function updateDashboard() {
        const date = document.getElementById('attDate').value;
        const dayRecords = records.filter(r => r.date === date);

        let p = 0, l = 0, a = 0, v = 0;
        dayRecords.forEach(r => {
            if (r.status === 'P') p++;
            if (r.status === 'L') l++;
            if (r.status === 'A') a++;
            if (r.status === 'V') v++;
        });

        document.getElementById('statP').innerText = p;
        document.getElementById('statL').innerText = l;
        document.getElementById('statA').innerText = a;
        document.getElementById('statV').innerText = v;

        const total = students.length;
        const rate = total > 0 ? Math.round(((p + l) / total) * 100) : 0;

        document.getElementById('ratePercent').innerText = `${rate}%`;
        document.getElementById('progressBar').style.width = `${rate}%`;

        renderDailyPieChart(p, l, a, v);
    }

    function getThemeColors() {
        const computedStyle = getComputedStyle(document.body);
        return {
            primary: computedStyle.getPropertyValue('--primary').trim() || '#00ff66',
            secondary: computedStyle.getPropertyValue('--secondary').trim() || '#00f0ff',
            warning: computedStyle.getPropertyValue('--warning').trim() || '#ffb700',
            danger: computedStyle.getPropertyValue('--danger').trim() || '#ff0055',
            text: computedStyle.getPropertyValue('--text-main').trim() || '#00ff66'
        };
    }

    function renderDailyPieChart(p, l, a, v) {
        const ctx = document.getElementById('dailyPieChart')?.getContext('2d');
        if (!ctx) return;

        const colors = getThemeColors();

        if (dailyChartInstance) {
            dailyChartInstance.destroy();
        }

        dailyChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['វត្តមាន (Present)', 'យឺត (Late)', 'អវត្តមាន (Absent)', 'ច្បាប់ (Leave)'],
                datasets: [{
                    data: [p, l, a, v],
                    backgroundColor: [colors.primary, colors.warning, colors.danger, colors.secondary],
                    borderColor: 'transparent',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: colors.text,
                            font: { family: 'Kantumruy Pro', size: 11 }
                        }
                    }
                }
            }
        });
    }

    function renderMonthlyBarChart(monthVal, monthRecords) {
        const ctx = document.getElementById('monthlyBarChart')?.getContext('2d');
        if (!ctx) return;

        const colors = getThemeColors();
        const daysInMonth = new Date(monthVal.split('-')[0], monthVal.split('-')[1], 0).getDate();
        
        const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const presentData = [];
        const absentData = [];

        labels.forEach(day => {
            const dayStr = `${monthVal}-${String(day).padStart(2, '0')}`;
            const dayRecs = monthRecords.filter(r => r.date === dayStr);
            let pCount = dayRecs.filter(r => r.status === 'P' || r.status === 'L').length;
            let aCount = dayRecs.filter(r => r.status === 'A').length;

            presentData.push(pCount);
            absentData.push(aCount);
        });

        if (monthlyChartInstance) {
            monthlyChartInstance.destroy();
        }

        monthlyChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'វត្តមាន (Present)',
                        data: presentData,
                        backgroundColor: colors.primary
                    },
                    {
                        label: 'អវត្តមាន (Absent)',
                        data: absentData,
                        backgroundColor: colors.danger
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: colors.text, font: { size: 9 } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        ticks: { color: colors.text, precision: 0 },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: colors.text,
                            font: { family: 'Kantumruy Pro', size: 10 }
                        }
                    }
                }
            }
        });
    }

    function updateHistoryDropdown() {
        const select = document.getElementById('selectStudentHistory');
        const selectedValue = select.value;
        select.innerHTML = '<option value="">-- ជ្រើសរើសលេខ ID ឬឈ្មោះ --</option>';

        students.sort((a, b) => a.id - b.id);
        students.forEach(s => {
            select.innerHTML += `<option value="${s.id}">[ID: #${s.id}] ${s.name}</option>`;
        });

        select.value = selectedValue;
    }

    function viewStudentHistory() {
        const studentId = parseInt(document.getElementById('selectStudentHistory').value);
        const resultDiv = document.getElementById('historyResult');

        if (!studentId) {
            resultDiv.innerHTML = '';
            return;
        }

        const startDate = document.getElementById('historyStartDate')?.value || '';
        const endDate = document.getElementById('historyEndDate')?.value || '';
        const filterStatus = document.getElementById('historyFilterStatus')?.value || 'ALL';

        let studentRecords = records.filter(r => r.studentId === studentId);

        if (startDate) studentRecords = studentRecords.filter(r => r.date >= startDate);
        if (endDate) studentRecords = studentRecords.filter(r => r.date <= endDate);

        let present = 0, late = 0, absent = 0, leave = 0;
        studentRecords.forEach(r => {
            if (r.status === 'P') present++;
            else if (r.status === 'L') late++;
            else if (r.status === 'A') absent++;
            else if (r.status === 'V') leave++;
        });

        let displayedRecords = [...studentRecords];
        if (filterStatus !== 'ALL') {
            displayedRecords = displayedRecords.filter(r => r.status === filterStatus);
        }

        const totalDays = studentRecords.length;
        const attendRate = totalDays > 0 ? Math.round(((present + late) / totalDays) * 100) : 0;

        let html = `
            <div style="margin-top:10px; font-size:12px; font-weight:600;">
                អត្រាវត្តមានសរុប៖ <span style="color:var(--primary);">${attendRate}%</span> (${present + late} / ${totalDays} ថ្ងៃ)
            </div>
            <div class="stats-grid" style="margin-top:10px;">
                <div class="stat-box" style="color:var(--primary);">វត្តមាន<b>${present} ថ្ងៃ</b></div>
                <div class="stat-box" style="color:var(--warning);">យឺត<b>${late} ថ្ងៃ</b></div>
                <div class="stat-box" style="color:var(--danger);">អវត្តមាន<b>${absent} ថ្ងៃ</b></div>
                <div class="stat-box" style="color:var(--secondary);">ច្បាប់<b>${leave} ថ្ងៃ</b></div>
            </div>
            <br>
            <b>ប្រវត្តិនៃការកត់ត្រា (${displayedRecords.length}):</b>
        `;

        if (displayedRecords.length === 0) {
            html += '<p><small style="color:gray;">មិនទាន់មានប្រវត្តិដែលត្រូវគ្នានឹងតម្រងស្វែងរក។</small></p>';
        } else {
            displayedRecords.sort((a, b) => b.date.localeCompare(a.date));

            html += `
                <table>
                    <thead>
                        <tr>
                            <th>ថ្ងៃខែ</th>
                            <th>ស្ថានភាព</th>
                            <th>ម៉ោង (ចូល/ចេញ)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            displayedRecords.forEach(r => {
                let statusText = "វត្តមាន (Present)";
                if (r.status === 'L') statusText = "យឺត (Late)";
                if (r.status === 'A') statusText = "អវត្តមាន (Absent)";
                if (r.status === 'V') statusText = "ច្បាប់ (Leave)";

                let timeStr = (r.timeIn || '--:--') + ' -> ' + (r.timeOut || '--:--');

                html += `
                    <tr>
                        <td>${r.date}</td>
                        <td>${statusText}</td>
                        <td>${timeStr}</td>
                    </tr>
                `;
            });

            html += '</tbody></table>';
        }

        resultDiv.innerHTML = html;
    }
    

    loadReminderConfig();
    applyViewMode();
    renderStudents();
    renderMarkArea();
    generateReport();
    updateCSVArea();
    updateHistoryDropdown();
    generateMonthlyReport();
