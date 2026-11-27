/**
 * ============================================================================
 * POS MINIMARKET MANDIRI - TAHAP 2
 * Fitur Baru Tahap 2:
 *  1. Database Offline IndexedDB via Dexie.js (tabel: users, products,
 *     transactions, debts, settings).
 *  2. Manajemen Kasir Lengkap (Nama, Username/ID, PIN, Role, Status Aktif/Nonaktif,
 *     Edit PIN, serta Nonaktifkan kasir tanpa menghapus riwayat transaksi).
 *  3. Manajemen Produk & Stok Lengkap (Kode Barcode, Nama, Kategori, Harga Modal,
 *     Harga Jual Eceran, Jumlah Stok, Batas Stok Minimum, serta Ekspor & Impor CSV/Excel).
 * ============================================================================
 */

// Inisialisasi Database Offline Dexie.js (IndexedDB)
const db = new Dexie("POSMinimarketDB");
db.version(1).stores({
  users: "id, username, role, status",
  products: "id, barcode, name, category, stock, minStock",
  transactions: "id, timestamp, cashierId",
  debts: "id, customerName, status, createdAt",
  settings: "key"
});

const SESSION_ACTIVE_USER_KEY = "pos_mm_session_user_id_v2";

// Data Akun Bawaan Awal
const DEFAULT_USERS = [
  {
    id: "usr_admin",
    name: "Admin",
    username: "admin",
    pin: "1234",
    role: "admin",
    status: "active"
  },
  {
    id: "usr_kasir1",
    name: "Kasir 1",
    username: "kasir1",
    pin: "1111",
    role: "kasir",
    status: "active"
  }
];

// Data Produk Contoh Minimarket (dengan Barcode & Batas Stok Minimum)
const DEFAULT_PRODUCTS = [
  { id: "prd_1", barcode: "8998866200578", name: "Indomie Goreng Original", category: "Makanan", cost: 2600, price: 3500, stock: 48, minStock: 10 },
  { id: "prd_2", barcode: "8886008101053", name: "Aqua Air Mineral 600ml", category: "Minuman", cost: 2800, price: 4000, stock: 36, minStock: 12 },
  { id: "prd_3", barcode: "8991002101122", name: "Beras Premium Ramos 5kg", category: "Sembako", cost: 68000, price: 75000, stock: 4, minStock: 5 },
  { id: "prd_4", barcode: "8992761111014", name: "Minyak Goreng Bimoli 1L", category: "Sembako", cost: 16500, price: 19000, stock: 24, minStock: 6 },
  { id: "prd_5", barcode: "8991002105434", name: "Kopi Kapal Api Special 165g", category: "Minuman", cost: 12500, price: 15000, stock: 20, minStock: 5 },
  { id: "prd_6", barcode: "8996001301012", name: "Teh Botol Sosro Kotak 250ml", category: "Minuman", cost: 3000, price: 4500, stock: 30, minStock: 10 },
  { id: "prd_7", barcode: "8992745123456", name: "Gula Pasir Gulaku 1kg", category: "Sembako", cost: 15500, price: 18000, stock: 3, minStock: 5 },
  { id: "prd_8", barcode: "8999999034511", name: "Pulpen Standard AE7 Hitam", category: "ATK", cost: 2000, price: 3000, stock: 40, minStock: 10 }
];

// Konfigurasi Struktur Struk Bawaan Lengkap (Tahap 4)
const DEFAULT_RECEIPT_CONFIG = {
  storeName: "MINIMARKET MANDIRI",
  storeSlogan: "Belanja Hemat & Lengkap Setiap Hari",
  storeAddress: "Jl. Raya Utama No. 12, Indonesia",
  storePhone: "0812-3456-7890",
  footerLine1: "Barang yang sudah dibeli tidak dapat ditukar.",
  footerLine2: "Terima kasih atas kunjungan Anda!",
  paperSize: "58", // "58" (32 karakter) | "80" (48 karakter)
  logoDataUrl: "", // DataURL PNG Hitam-Putih Murni (Monochrome Dithered)
  showLogo: true,
  showAddressPhone: true,
  showCashier: true,
  showReceiptNoDate: true,
  showCustomer: true,
  showItemDiscount: true,
  showTotalSavings: true,
  showPaymentDetails: true,
  showFooter: true
};

// Variabel Transaksi Struk Terbuka & Printer Bluetooth
let activeReceiptTx = null;
let tempLogoDataUrl = "";
let bluetoothDevice = null;
let bluetoothCharacteristic = null;

const HELD_CARTS_STORAGE_KEY = "pos_mm_held_carts_v3";

// State Aplikasi Berjalan
let state = {
  users: [],
  products: [],
  transactions: [],
  debts: [],
  receiptConfig: { ...DEFAULT_RECEIPT_CONFIG },
  selectedLoginUserId: null,
  pinBuffer: "",
  currentUser: null,
  activeTab: "kasir",
  cart: [], // { productId, barcode, name, price, cost, qty, discountType, discountValue }
  cartDiscountType: "nominal",
  cartDiscountValue: 0,
  paymentMethod: "cash", // "cash" | "non-cash" | "debt"
  heldCarts: [],
  pendingCsvRows: []
};

// Variabel untuk Dual Barcode Scanner & Audio Beep
let externalScanBuffer = "";
let externalScanLastTime = 0;
let html5QrScanner = null;
let lastCameraScanCode = "";
let lastCameraScanTime = 0;
let sharedAudioCtx = null;
let cameraScanMode = "kasir"; // "kasir" | "product"

// ============================================================================
// FUNGSI BANTUAN FORMAT RUPIAH, KEAMANAN HTML, & DATABASE DEXIE.JS
// ============================================================================
function formatRupiah(angka) {
  const num = Number(angka) || 0;
  return "Rp " + num.toLocaleString("id-ID");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  const bgClass =
    type === "error"
      ? "bg-rose-600 text-white"
      : type === "success"
      ? "bg-emerald-600 text-white"
      : "bg-slate-900 text-white";

  toast.className = `${bgClass} px-4 py-3 rounded-2xl shadow-xl text-xs md:text-sm font-bold transition-all duration-300`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Inisialisasi & Muat Data dari IndexedDB (Dexie.js)
async function initDatabase() {
  try {
    await db.open();

    // 1. Cek & isi data users awal jika tabel users masih kosong
    const userCount = await db.users.count();
    if (userCount === 0) {
      await db.users.bulkAdd(DEFAULT_USERS);
    }

    // 2. Cek & isi data products awal jika tabel products masih kosong
    const productCount = await db.products.count();
    if (productCount === 0) {
      await db.products.bulkAdd(DEFAULT_PRODUCTS);
    }

    // 3. Cek & isi settings struk awal jika belum ada
    const receiptSetting = await db.settings.get("receiptConfig");
    if (!receiptSetting) {
      await db.settings.put({ key: "receiptConfig", value: { ...DEFAULT_RECEIPT_CONFIG } });
    }

    await refreshStateFromDB();

    // Cek sesi login aktif
    const savedUserId = sessionStorage.getItem(SESSION_ACTIVE_USER_KEY);
    if (savedUserId) {
      const found = state.users.find((u) => u.id === savedUserId && u.status === "active");
      if (found) {
        state.currentUser = found;
      } else {
        sessionStorage.removeItem(SESSION_ACTIVE_USER_KEY);
      }
    }
  } catch (err) {
    console.error("Kesalahan IndexedDB:", err);
    showToast("Gagal memuat database offline browser.", "error");
  }
}

async function refreshStateFromDB() {
  state.users = await db.users.toArray();
  state.products = await db.products.toArray();
  state.transactions = await db.transactions.orderBy("timestamp").reverse().toArray();
  state.debts = await db.debts.toArray();

  const receiptSetting = await db.settings.get("receiptConfig");
  state.receiptConfig = receiptSetting
    ? { ...DEFAULT_RECEIPT_CONFIG, ...receiptSetting.value }
    : { ...DEFAULT_RECEIPT_CONFIG };
}

// ============================================================================
// 1. LOGIKA HALAMAN LOGIN & HAK AKSES (RBAC + STATUS AKTIF/NONAKTIF)
// ============================================================================
function renderLoginScreen() {
  document.getElementById("login-store-title").textContent = state.receiptConfig.storeName;
  const listEl = document.getElementById("login-account-list");
  listEl.innerHTML = "";

  // Hanya tampilkan akun dengan status 'active' di layar login
  const activeUsers = state.users.filter((u) => u.status === "active");

  if (activeUsers.length > 0) {
    const stillValid = activeUsers.some((u) => u.id === state.selectedLoginUserId);
    if (!stillValid) {
      state.selectedLoginUserId = activeUsers[0].id;
    }
  } else {
    state.selectedLoginUserId = null;
  }

  if (activeUsers.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-rose-600 font-bold">Tidak ada akun aktif tersedia.</p>`;
  }

  activeUsers.forEach((user) => {
    const isSelected = user.id === state.selectedLoginUserId;
    const isAdmin = user.role === "admin";

    const card = document.createElement("button");
    card.type = "button";
    card.className = `w-full text-left p-3.5 rounded-2xl border-2 transition flex items-center justify-between ${
      isSelected
        ? "border-sky-600 bg-sky-50 shadow-sm"
        : "border-slate-200 bg-white hover:border-slate-300"
    }`;

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-base ${
          isAdmin ? "bg-indigo-600 text-white" : "bg-sky-600 text-white"
        }">
          ${escapeHtml(user.name.charAt(0).toUpperCase())}
        </div>
        <div>
          <p class="font-extrabold text-sm text-slate-900">${escapeHtml(user.name)}</p>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              isAdmin ? "bg-indigo-100 text-indigo-800" : "bg-emerald-100 text-emerald-800"
            }">
              ${isAdmin ? "Admin" : "Kasir"}
            </span>
            <span class="text-[11px] font-mono text-slate-400">@${escapeHtml(user.username || user.id)}</span>
          </div>
        </div>
      </div>
      <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center ${
        isSelected ? "border-sky-600" : "border-slate-300"
      }">
        ${isSelected ? '<div class="w-2.5 h-2.5 rounded-full bg-sky-600"></div>' : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      state.selectedLoginUserId = user.id;
      state.pinBuffer = "";
      document.getElementById("login-error-msg").textContent = "";
      updatePinDisplay();
      renderLoginScreen();
    });

    listEl.appendChild(card);
  });

  const selectedUser = activeUsers.find((u) => u.id === state.selectedLoginUserId);
  document.getElementById("selected-account-label").textContent = selectedUser
    ? `Akun: ${selectedUser.name} (@${selectedUser.username || ""})`
    : "Pilih akun di samping";
  updatePinDisplay();
}

function updatePinDisplay() {
  const dotsEl = document.getElementById("pin-dots");
  if (state.pinBuffer.length === 0) {
    dotsEl.textContent = "------";
    dotsEl.classList.add("text-slate-300");
    dotsEl.classList.remove("text-slate-900");
  } else {
    dotsEl.textContent = "•".repeat(state.pinBuffer.length);
    dotsEl.classList.remove("text-slate-300");
    dotsEl.classList.add("text-slate-900");
  }
}

function handlePinDigit(digit) {
  if (state.pinBuffer.length >= 6) return;
  state.pinBuffer += digit;
  document.getElementById("login-error-msg").textContent = "";
  updatePinDisplay();

  const targetUser = state.users.find(
    (u) => u.id === state.selectedLoginUserId && u.status === "active"
  );
  if (targetUser && state.pinBuffer === targetUser.pin) {
    completeLogin(targetUser);
  }
}

function handlePinSubmit() {
  const targetUser = state.users.find((u) => u.id === state.selectedLoginUserId);
  if (!targetUser) {
    document.getElementById("login-error-msg").textContent = "Pilih akun terlebih dahulu!";
    return;
  }

  if (targetUser.status !== "active") {
    triggerPinError("Akun ini berstatus Nonaktif!");
    return;
  }

  if (state.pinBuffer.length < 4) {
    triggerPinError("PIN minimal 4 digit!");
    return;
  }

  if (state.pinBuffer === targetUser.pin) {
    completeLogin(targetUser);
  } else {
    triggerPinError("PIN salah! Silakan coba lagi.");
  }
}

function triggerPinError(msg) {
  const box = document.getElementById("pin-display-box");
  document.getElementById("login-error-msg").textContent = msg;
  state.pinBuffer = "";
  updatePinDisplay();
  box.classList.remove("animate-shake");
  void box.offsetWidth;
  box.classList.add("animate-shake");
}

function completeLogin(user) {
  state.currentUser = user;
  state.pinBuffer = "";
  state.cart = [];
  sessionStorage.setItem(SESSION_ACTIVE_USER_KEY, user.id);

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");

  applyRolePermissions();
  switchTab("kasir");
  showToast(`Selamat bertugas, ${user.name}!`, "success");
}

function logoutUser() {
  state.currentUser = null;
  state.pinBuffer = "";
  state.cart = [];
  sessionStorage.removeItem(SESSION_ACTIVE_USER_KEY);

  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  renderLoginScreen();
  showToast("Berhasil keluar shift.");
}

function applyRolePermissions() {
  if (!state.currentUser) return;
  const isAdmin = state.currentUser.role === "admin";

  document.getElementById("header-store-name").textContent = state.receiptConfig.storeName;
  document.getElementById("header-user-name").textContent = state.currentUser.name;

  const roleBadge = document.getElementById("header-user-role");
  roleBadge.textContent = isAdmin ? "ADMIN" : "KASIR";
  roleBadge.className = `px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
    isAdmin ? "bg-indigo-500 text-white" : "bg-emerald-500 text-white"
  }`;

  document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
    if (isAdmin) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// ============================================================================
// 2. NAVIGASI TAB & RESPONSIF HP VS TABLET
// ============================================================================
function switchTab(tabName) {
  const isAdmin = state.currentUser && state.currentUser.role === "admin";

  if (tabName === "pengaturan" && !isAdmin) {
    showToast("Akses ditolak: Khusus Admin!", "error");
    tabName = "kasir";
  }

  state.activeTab = tabName;

  document.querySelectorAll(".tab-view").forEach((sec) => sec.classList.add("hidden"));
  const targetView = document.getElementById(`view-${tabName}`);
  if (targetView) targetView.classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.className = `nav-btn px-4 py-2.5 rounded-xl text-sm font-bold transition ${
      active
        ? "bg-sky-600 text-white shadow"
        : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;
  });

  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.className = `mobile-nav-btn flex-1 h-full flex flex-col items-center justify-center gap-0.5 text-xs font-bold ${
      active ? "text-sky-600 bg-sky-50/70" : "text-slate-500"
    }`;
  });

  if (tabName === "kasir") {
    resetMobileKasirPane();
    populateKasirCategories();
    renderKasirProducts();
    renderCart();
  } else if (tabName === "produk") {
    renderManageProducts();
  } else if (tabName === "riwayat") {
    renderHistoryView();
  }  else if (tabName === "kasbon") {
    renderDebtsView();
  } else if (tabName === "pengaturan" && isAdmin) {
    renderSettingsView();
  }
}

function resetMobileKasirPane() {
  const prodPane = document.getElementById("kasir-products-pane");
  const cartPane = document.getElementById("kasir-cart-pane");
  prodPane.classList.remove("hidden");
  cartPane.classList.add("hidden");
  cartPane.classList.add("md:flex");
}

function showMobileCartPane() {
  const prodPane = document.getElementById("kasir-products-pane");
  const cartPane = document.getElementById("kasir-cart-pane");
  prodPane.classList.add("hidden");
  cartPane.classList.remove("hidden");
  cartPane.classList.add("flex");
}

// ============================================================================
// 3. DUAL BARCODE SCANNER (HID & KAMERA), BEEP AUDIO, KERANJANG, HOLD & BAYAR
// ============================================================================

// Suara Beep Singkat via Web Audio API (100% Offline Tanpa File MP3)
function playBeepSound(success = true) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume();
    }

    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    if (success) {
      osc.type = "sine";
      osc.frequency.setValueAtTime(1850, sharedAudioCtx.currentTime);
      gain.gain.setValueAtTime(0.18, sharedAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + 0.09);
      osc.start();
      osc.stop(sharedAudioCtx.currentTime + 0.09);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(320, sharedAudioCtx.currentTime);
      gain.gain.setValueAtTime(0.18, sharedAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + 0.22);
      osc.start();
      osc.stop(sharedAudioCtx.currentTime + 0.22);
    }
  } catch (err) {
    // Abaikan jika browser memblokir audio sebelum interaksi pertama
  }
}

// Cek apakah ada modal/pop-up yang sedang terbuka
function isAnyModalOpen() {
  const modalIds = [
    "modal-product",
    "modal-edit-account",
    "modal-import-csv",
    "modal-receipt",
    "modal-camera-scanner",
    "modal-held-carts",
    "modal-item-discount",
    "modal-tx-detail",
    "modal-void-auth",
    "modal-debt-payment",
    "modal-add-manual-debt",
    "modal-export-report"
  ];
  return modalIds.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
}

// Proses hasil pindai barcode (dari alat HID eksternal maupun kamera)
function handleBarcodeScanned(rawCode, sourceLabel = "Scanner") {
  const code = String(rawCode || "").trim();
  if (!code) return false;

  const matchedProduct = state.products.find(
    (p) => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
  );

  const statusTextEl = document.getElementById("scanner-status-text");
  const camFeedbackEl = document.getElementById("camera-scan-feedback");

  if (!matchedProduct) {
    playBeepSound(false);
    showToast(`Barcode "${code}" tidak terdaftar!`, "error");
    if (camFeedbackEl) {
      camFeedbackEl.textContent = `Barcode "${code}" tidak ditemukan di database.`;
      camFeedbackEl.className = "p-3 rounded-xl bg-rose-50 border border-rose-200 text-center text-xs font-extrabold text-rose-700";
    }
    return false;
  }

  const added = addToCart(matchedProduct.id, true);
  if (added) {
    playBeepSound(true);
    showToast(`${sourceLabel}: +1 ${matchedProduct.name}`, "success");
    if (statusTextEl) {
      statusTextEl.textContent = `Terbaca: ${matchedProduct.name}`;
      setTimeout(() => {
        if (statusTextEl) statusTextEl.textContent = "Scanner Eksternal Siap";
      }, 2200);
    }
    if (camFeedbackEl) {
      camFeedbackEl.textContent = `Berhasil: +1 ${matchedProduct.name} (${formatRupiah(matchedProduct.price)})`;
      camFeedbackEl.className = "p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center text-xs font-extrabold text-emerald-700";
    }
    return true;
  } else {
    playBeepSound(false);
    return false;
  }
}

// Mode 1: Pendeteksi Global Alat Barcode Scanner Eksternal (USB OTG / Bluetooth HID)
function setupGlobalHardwareScanner() {
  document.addEventListener("keydown", (e) => {
    if (!state.currentUser) return;
    if (state.activeTab !== "kasir" && state.activeTab !== "produk") return;

    if (isAnyModalOpen()) {
      externalScanBuffer = "";
      return;
    }

    const activeEl = document.activeElement;
    const isTypingInInput =
      activeEl &&
      (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT") &&
      activeEl.id !== "kasir-search-input";

    if (isTypingInInput) {
      externalScanBuffer = "";
      return;
    }

    const now = Date.now();
    // Alat scanner fisik mengirim karakter sangat cepat (< 85ms antar karakter)
    if (now - externalScanLastTime > 85) {
      externalScanBuffer = "";
    }
    externalScanLastTime = now;

    if (e.key === "Enter") {
      if (externalScanBuffer.length >= 3) {
        e.preventDefault();
        const scannedCode = externalScanBuffer;
        externalScanBuffer = "";

        if (state.activeTab === "kasir") {
          const searchInput = document.getElementById("kasir-search-input");
          if (searchInput && document.activeElement === searchInput) {
            searchInput.value = "";
            renderKasirProducts();
          }
          handleBarcodeScanned(scannedCode, "Scanner");
        } else if (state.activeTab === "produk" && state.currentUser.role === "admin") {
          handleProductBarcodeInput(scannedCode);
        }
      }
      externalScanBuffer = "";
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      externalScanBuffer += e.key;
    }
  });
}

// Mode 2: Kamera HP / Tablet (Mendukung Mode Kasir & Mode Input Barang)
async function openCameraScannerModal(mode = "kasir") {
  cameraScanMode = mode;
  const modal = document.getElementById("modal-camera-scanner");
  const titleEl = document.getElementById("camera-scanner-title");
  const subtitleEl = document.getElementById("camera-scanner-subtitle");
  const feedbackEl = document.getElementById("camera-scan-feedback");

  if (mode === "product") {
    titleEl.textContent = "Scan Barcode Input Barang";
    subtitleEl.textContent = "Scan barcode kemasan untuk mengisi form produk otomatis";
  } else {
    titleEl.textContent = "Scan Barcode Kasir";
    subtitleEl.textContent = "Arahkan kamera ke barcode kemasan produk";
  }

  feedbackEl.textContent = "Membuka kamera perangkat...";
  feedbackEl.className = "p-3 rounded-xl bg-white border border-slate-200 text-center text-xs font-bold text-slate-600";
  modal.classList.remove("hidden");

  if (typeof Html5Qrcode === "undefined") {
    feedbackEl.textContent = "Library kamera belum termuat. Pastikan terhubung internet saat pertama membuka halaman.";
    return;
  }

  try {
    html5QrScanner = new Html5Qrcode("qr-reader");
    await html5QrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 140 } },
      async (decodedText) => {
        const now = Date.now();
        if (decodedText === lastCameraScanCode && now - lastCameraScanTime < 1400) {
          return;
        }
        lastCameraScanCode = decodedText;
        lastCameraScanTime = now;

        if (cameraScanMode === "product") {
          await closeCameraScannerModal();
          handleProductBarcodeInput(decodedText);
        } else {
          handleBarcodeScanned(decodedText, "Kamera");
        }
      },
      () => {
        // Abaikan frame yang belum terbaca barcodenya
      }
    );
    feedbackEl.textContent = "Kamera aktif. Arahkan ke barcode barang...";
  } catch (err) {
    console.error("Kamera error:", err);
    feedbackEl.textContent = "Gagal mengakses kamera. Pastikan izin kamera di browser sudah diizinkan.";
  }
}

async function closeCameraScannerModal() {
  const modal = document.getElementById("modal-camera-scanner");
  modal.classList.add("hidden");
  if (html5QrScanner) {
    try {
      await html5QrScanner.stop();
      html5QrScanner.clear();
    } catch (err) {
      // Abaikan jika sudah berhenti
    }
    html5QrScanner = null;
  }
}

// Proses Barcode untuk Tambah / Edit Barang (Admin)
function handleProductBarcodeInput(rawCode) {
  if (!state.currentUser || state.currentUser.role !== "admin") return;

  const code = String(rawCode || "").trim();
  if (!code) return;

  const modal = document.getElementById("modal-product");
  const isModalOpen = !modal.classList.contains("hidden");
  const editingId = document.getElementById("prod-id").value;

  const existingProduct = state.products.find(
    (p) => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
  );

  playBeepSound(true);

  if (existingProduct) {
    // Jika sedang mengedit barang lain yang berbeda ID, peringatkan duplikat
    if (isModalOpen && editingId && editingId !== existingProduct.id) {
      showToast(`Barcode sudah dipakai oleh "${existingProduct.name}"!`, "error");
      return;
    }

    // Buka form Edit untuk barang yang sudah ada & fokus langsung ke kolom Stok
    openProductModal(existingProduct);
    showToast(`Barang sudah ada: "${existingProduct.name}". Silakan update stok/harga.`, "info");
    setTimeout(() => {
      const stockInput = document.getElementById("prod-stock");
      stockInput.focus();
      stockInput.select();
    }, 60);
    return;
  }

  // Jika barcode baru belum ada di database
  if (!isModalOpen) {
    openProductModal(null);
  }
  document.getElementById("prod-barcode").value = code;
  showToast(`Barcode terbaca: ${code}. Lengkapi nama & harga barang.`, "success");

  setTimeout(() => {
    document.getElementById("prod-name").focus();
  }, 60);
}

function populateKasirCategories() {
  const select = document.getElementById("kasir-category-filter");
  const currentVal = select.value;
  const categories = [...new Set(state.products.map((p) => p.category))];

  select.innerHTML = `<option value="ALL">Semua Kategori</option>`;
  categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });

  if (categories.includes(currentVal)) {
    select.value = currentVal;
  }
}

function renderKasirProducts() {
  const grid = document.getElementById("kasir-product-grid");
  const keyword = document.getElementById("kasir-search-input").value.trim().toLowerCase();
  const category = document.getElementById("kasir-category-filter").value;

  const filtered = state.products.filter((p) => {
    const matchName = p.name.toLowerCase().includes(keyword);
    const matchBarcode = (p.barcode || "").toLowerCase().includes(keyword);
    const matchCat = category === "ALL" || p.category === category;
    return (matchName || matchBarcode) && matchCat;
  });

  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 text-slate-400">
        <p class="font-bold text-base">Barang tidak ditemukan</p>
        <p class="text-xs mt-1">Coba kata kunci, barcode, atau kategori lain.</p>
      </div>
    `;
    return;
  }

  filtered.forEach((product) => {
    const inCart = state.cart.find((c) => c.productId === product.id);
    const qtyInCart = inCart ? inCart.qty : 0;
    const remainingStock = product.stock - qtyInCart;
    const outOfStock = remainingStock <= 0;
    const isLowStock = remainingStock > 0 && remainingStock <= (product.minStock || 0);

    const card = document.createElement("button");
    card.type = "button";
    card.disabled = outOfStock;
    card.className = `text-left p-3.5 rounded-2xl border transition flex flex-col justify-between min-h-[132px] shadow-xs relative ${
      outOfStock
        ? "bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed"
        : qtyInCart > 0
        ? "bg-sky-50 border-sky-500 ring-1 ring-sky-500"
        : "bg-white border-slate-200 hover:border-sky-400 active:scale-[0.98]"
    }`;

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between gap-1 mb-1">
          <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 truncate">
            ${escapeHtml(product.category)}
          </span>
          <span class="text-[11px] font-bold ${
            outOfStock ? "text-rose-600" : isLowStock ? "text-amber-600" : "text-slate-500"
          }">
            Stok: ${remainingStock}
          </span>
        </div>
        <h3 class="font-bold text-sm text-slate-900 line-clamp-2 leading-snug">${escapeHtml(product.name)}</h3>
        ${
          product.barcode
            ? `<p class="text-[10px] font-mono text-slate-400 mt-0.5 truncate">${escapeHtml(product.barcode)}</p>`
            : ""
        }
      </div>
      <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
        <span class="font-extrabold text-sm md:text-base text-sky-700">${formatRupiah(product.price)}</span>
        ${
          qtyInCart > 0
            ? `<span class="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-extrabold flex items-center justify-center">${qtyInCart}</span>`
            : `<span class="text-xs font-bold text-sky-600">+ Tambah</span>`
        }
      </div>
    `;

    card.addEventListener("click", () => addToCart(product.id, false));
    grid.appendChild(card);
  });
}

function addToCart(productId, silentToast = false) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return false;

  const existing = state.cart.find((item) => item.productId === productId);
  const currentQty = existing ? existing.qty : 0;

  if (currentQty + 1 > product.stock) {
    showToast(`Stok ${product.name} tidak mencukupi!`, "error");
    return false;
  }

  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      productId: product.id,
      barcode: product.barcode || "",
      name: product.name,
      price: product.price,
      cost: product.cost,
      qty: 1,
      discountType: "nominal",
      discountValue: 0
    });
  }

  renderKasirProducts();
  renderCart();
  return true;
}

function updateCartQty(productId, delta) {
  const index = state.cart.findIndex((item) => item.productId === productId);
  if (index === -1) return;

  const product = state.products.find((p) => p.id === productId);
  const newQty = state.cart[index].qty + delta;

  if (newQty <= 0) {
    state.cart.splice(index, 1);
  } else if (product && newQty > product.stock) {
    showToast("Melebihi batas stok tersedia!", "error");
    return;
  } else {
    state.cart[index].qty = newQty;
  }

  renderKasirProducts();
  renderCart();
}

// Perhitungan Diskon Per Item & Diskon Total Belanja
function getCartItemDiscountAmount(item) {
  const gross = item.price * item.qty;
  const val = Number(item.discountValue) || 0;
  if (val <= 0) return 0;
  if (item.discountType === "percent") {
    return Math.round(gross * (Math.min(100, val) / 100));
  }
  return Math.min(gross, val);
}

function getCartItemNetSubtotal(item) {
  return Math.max(0, item.price * item.qty - getCartItemDiscountAmount(item));
}

function getCartCalculation() {
  const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotalAfterItemDisc = state.cart.reduce((sum, item) => sum + getCartItemNetSubtotal(item), 0);

  const discType = document.getElementById("cart-discount-type").value;
  const discVal = Math.max(0, Number(document.getElementById("cart-discount-input").value) || 0);
  state.cartDiscountType = discType;
  state.cartDiscountValue = discVal;

  let cartDiscountAmount = 0;
  if (discVal > 0 && subtotalAfterItemDisc > 0) {
    cartDiscountAmount =
      discType === "percent"
        ? Math.round(subtotalAfterItemDisc * (Math.min(100, discVal) / 100))
        : Math.min(subtotalAfterItemDisc, discVal);
  }

  const grandTotal = Math.max(0, subtotalAfterItemDisc - cartDiscountAmount);
  return {
    totalQty,
    subtotalAfterItemDisc,
    cartDiscountAmount,
    grandTotal
  };
}

function openItemDiscountModal(productId) {
  const item = state.cart.find((c) => c.productId === productId);
  if (!item) return;

  document.getElementById("disc-item-product-id").value = item.productId;
  document.getElementById("disc-item-name").textContent = `${item.name} (${item.qty} x ${formatRupiah(item.price)})`;
  document.getElementById("disc-item-type").value = item.discountType || "nominal";
  document.getElementById("disc-item-value").value = item.discountValue || 0;
  document.getElementById("modal-item-discount").classList.remove("hidden");
}

function closeItemDiscountModal() {
  document.getElementById("modal-item-discount").classList.add("hidden");
}

function saveItemDiscountForm(e) {
  e.preventDefault();
  const productId = document.getElementById("disc-item-product-id").value;
  const item = state.cart.find((c) => c.productId === productId);
  if (!item) return;

  item.discountType = document.getElementById("disc-item-type").value;
  item.discountValue = Math.max(0, Number(document.getElementById("disc-item-value").value) || 0);

  closeItemDiscountModal();
  renderCart();
  showToast("Diskon barang diterapkan.", "success");
}

function removeItemDiscount() {
  const productId = document.getElementById("disc-item-product-id").value;
  const item = state.cart.find((c) => c.productId === productId);
  if (item) {
    item.discountType = "nominal";
    item.discountValue = 0;
  }
  closeItemDiscountModal();
  renderCart();
}

function renderCart() {
  const listEl = document.getElementById("cart-items-list");
  listEl.innerHTML = "";

  if (state.cart.length === 0) {
    listEl.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center text-slate-400 py-8">
        <svg class="w-11 h-11 mb-2 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <p class="font-bold text-sm">Keranjang masih kosong</p>
        <p class="text-xs mt-0.5">Scan barcode atau ketuk produk untuk menambahkan.</p>
      </div>
    `;
  } else {
    state.cart.forEach((item) => {
      const itemDisc = getCartItemDiscountAmount(item);
      const netSubtotal = getCartItemNetSubtotal(item);

      const row = document.createElement("div");
      row.className = "p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2";
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <p class="font-bold text-sm text-slate-900 truncate">${escapeHtml(item.name)}</p>
          <div class="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>${formatRupiah(item.price)} x ${item.qty}</span>
            <button type="button" data-action="disc" class="px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
              itemDisc > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600 hover:bg-slate-300"
            }">
              ${
                itemDisc > 0
                  ? `Diskon -${item.discountType === "percent" ? item.discountValue + "%" : formatRupiah(itemDisc)}`
                  : "+ Diskon"
              }
            </button>
          </div>
          <p class="text-xs font-extrabold text-sky-700 mt-0.5">${formatRupiah(netSubtotal)}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" data-action="dec" class="w-9 h-9 rounded-xl bg-white border border-slate-300 font-extrabold text-base text-slate-700 active:bg-slate-200">-</button>
          <span class="w-7 text-center font-extrabold text-sm">${item.qty}</span>
          <button type="button" data-action="inc" class="w-9 h-9 rounded-xl bg-sky-600 text-white font-extrabold text-base active:bg-sky-700">+</button>
        </div>
      `;

      row.querySelector('[data-action="disc"]').addEventListener("click", () => openItemDiscountModal(item.productId));
      row.querySelector('[data-action="dec"]').addEventListener("click", () => updateCartQty(item.productId, -1));
      row.querySelector('[data-action="inc"]').addEventListener("click", () => updateCartQty(item.productId, 1));
      listEl.appendChild(row);
    });
  }

  const calc = getCartCalculation();
  document.getElementById("cart-total-qty").textContent = `${calc.totalQty} pcs`;
  document.getElementById("cart-subtotal-amount").textContent = formatRupiah(calc.subtotalAfterItemDisc);
  document.getElementById("cart-grand-total").textContent = formatRupiah(calc.grandTotal);
  document.getElementById("mobile-cart-count").textContent = `${calc.totalQty} Item`;
  document.getElementById("mobile-cart-total").textContent = formatRupiah(calc.grandTotal);

  updateCheckoutValidation(calc.grandTotal);
}

// Pergantian Metode Pembayaran (Tunai / Non-Tunai / Kasbon)
function setPaymentMethod(method) {
  state.paymentMethod = method;

  document.querySelectorAll(".pay-method-btn").forEach((btn) => {
    const active = btn.dataset.payMethod === method;
    btn.className = `pay-method-btn py-2 rounded-xl text-xs font-extrabold border-2 transition ${
      active
        ? "border-sky-600 bg-sky-600 text-white shadow-xs"
        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
    }`;
  });

  document.getElementById("payment-panel-cash").classList.toggle("hidden", method !== "cash");
  document.getElementById("payment-panel-non-cash").classList.toggle("hidden", method !== "non-cash");
  document.getElementById("payment-panel-debt").classList.toggle("hidden", method !== "debt");

  const btnCheckout = document.getElementById("btn-checkout");
  if (method === "debt") {
    btnCheckout.textContent = "Simpan Kasbon & Cetak Struk";
    btnCheckout.className = "w-full h-12 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-sm md:text-base shadow-lg transition disabled:opacity-50";
  } else {
    btnCheckout.textContent = "Bayar & Cetak Struk";
    btnCheckout.className = "w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm md:text-base shadow-lg transition disabled:opacity-50";
  }

  updateCheckoutValidation();
}

function updateCheckoutValidation(grandTotal = getCartCalculation().grandTotal) {
  const checkoutBtn = document.getElementById("btn-checkout");
  const changeEl = document.getElementById("cart-change-amount");

  if (state.cart.length === 0) {
    changeEl.textContent = "Rp 0";
    changeEl.className = "text-sm md:text-base font-extrabold text-slate-400";
    checkoutBtn.disabled = true;
    return;
  }

  if (state.paymentMethod === "cash") {
    const cashInput = Number(document.getElementById("cash-received-input").value) || 0;
    if (cashInput < grandTotal) {
      changeEl.textContent = `Kurang ${formatRupiah(grandTotal - cashInput)}`;
      changeEl.className = "text-xs md:text-sm font-extrabold text-rose-600";
      checkoutBtn.disabled = true;
    } else {
      changeEl.textContent = formatRupiah(cashInput - grandTotal);
      changeEl.className = "text-sm md:text-base font-extrabold text-emerald-600";
      checkoutBtn.disabled = false;
    }
  } else if (state.paymentMethod === "non-cash") {
    checkoutBtn.disabled = false;
  } else if (state.paymentMethod === "debt") {
    const custName = document.getElementById("debt-customer-name").value.trim();
    checkoutBtn.disabled = custName.length === 0;
  }
}

// ============================================================================
// FITUR TAHAN / TUNDA TRANSAKSI (HOLD CART)
// ============================================================================
function loadHeldCarts() {
  try {
    const raw = localStorage.getItem(HELD_CARTS_STORAGE_KEY);
    state.heldCarts = raw ? JSON.parse(raw) : [];
  } catch (e) {
    state.heldCarts = [];
  }
  updateHeldCartBadge();
}

function saveHeldCarts() {
  localStorage.setItem(HELD_CARTS_STORAGE_KEY, JSON.stringify(state.heldCarts));
  updateHeldCartBadge();
}

function updateHeldCartBadge() {
  const badge = document.getElementById("held-cart-badge");
  if (badge) badge.textContent = state.heldCarts.length;
}

function holdCurrentCart() {
  if (state.cart.length === 0) {
    showToast("Keranjang masih kosong, tidak ada yang perlu ditahan.", "error");
    return;
  }

  const note = prompt("Masukkan nama pembeli atau catatan keranjang (opsional):", "") || "";
  const calc = getCartCalculation();

  state.heldCarts.unshift({
    id: "HOLD-" + Date.now().toString().slice(-5),
    label: note.trim() || `Pelanggan #${state.heldCarts.length + 1}`,
    heldAt: new Date().toISOString(),
    cashierName: state.currentUser.name,
    items: state.cart.map((item) => ({ ...item })),
    cartDiscountType: state.cartDiscountType,
    cartDiscountValue: state.cartDiscountValue,
    totalAmount: calc.grandTotal
  });

  saveHeldCarts();

  // Kosongkan keranjang aktif agar bisa melayani pembeli berikutnya
  state.cart = [];
  document.getElementById("cart-discount-input").value = "0";
  document.getElementById("cash-received-input").value = "";
  resetMobileKasirPane();
  renderKasirProducts();
  renderCart();
  showToast("Transaksi berhasil ditahan sementara!", "success");
}

function openHeldCartsModal() {
  const listEl = document.getElementById("held-carts-list");
  listEl.innerHTML = "";

  if (state.heldCarts.length === 0) {
    listEl.innerHTML = `<p class="text-center text-slate-400 font-bold py-8 text-sm">Tidak ada transaksi yang sedang ditunda.</p>`;
  } else {
    state.heldCarts.forEach((held) => {
      const timeStr = new Date(held.heldAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      const totalItems = held.items.reduce((s, i) => s + i.qty, 0);

      const card = document.createElement("div");
      card.className = "bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3";
      card.innerHTML = `
        <div>
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-sm text-slate-900">${escapeHtml(held.label)}</span>
            <span class="text-[11px] text-slate-400">• Pukul ${timeStr}</span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5">${totalItems} pcs • Total: <strong class="text-sky-700">${formatRupiah(held.totalAmount)}</strong></p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="restore" class="h-9 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold">Lanjutkan</button>
          <button type="button" data-action="delete" class="h-9 px-3 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-extrabold">Hapus</button>
        </div>
      `;

      card.querySelector('[data-action="restore"]').addEventListener("click", () => restoreHeldCart(held.id));
      card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteHeldCart(held.id));
      listEl.appendChild(card);
    });
  }

  document.getElementById("modal-held-carts").classList.remove("hidden");
}

function closeHeldCartsModal() {
  document.getElementById("modal-held-carts").classList.add("hidden");
}

function restoreHeldCart(holdId) {
  const target = state.heldCarts.find((h) => h.id === holdId);
  if (!target) return;

  if (state.cart.length > 0) {
    if (!confirm("Keranjang saat ini masih berisi barang. Ganti dengan transaksi yang ditunda?")) {
      return;
    }
  }

  state.cart = target.items.map((item) => ({ ...item }));
  document.getElementById("cart-discount-type").value = target.cartDiscountType || "nominal";
  document.getElementById("cart-discount-input").value = target.cartDiscountValue || 0;

  state.heldCarts = state.heldCarts.filter((h) => h.id !== holdId);
  saveHeldCarts();

  closeHeldCartsModal();
  renderKasirProducts();
  renderCart();
  showToast(`Melanjutkan transaksi "${target.label}"`, "success");
}

function deleteHeldCart(holdId) {
  state.heldCarts = state.heldCarts.filter((h) => h.id !== holdId);
  saveHeldCarts();
  openHeldCartsModal();
}

// ============================================================================
// PROSES CHECKOUT (TUNAI, NON-TUNAI QRIS/TRANSFER, & KASBON/HUTANG)
// ============================================================================
async function processCheckout() {
  if (state.cart.length === 0) return;

  const calc = getCartCalculation();
  const grandTotal = calc.grandTotal;
  const method = state.paymentMethod;

  let cashReceived = grandTotal;
  let changeAmount = 0;
  let customerName = "";
  let customerPhone = "";
  let paymentNote = "";

  if (method === "cash") {
    cashReceived = Number(document.getElementById("cash-received-input").value) || 0;
    if (cashReceived < grandTotal) {
      showToast("Uang tunai kurang dari total belanja!", "error");
      return;
    }
    changeAmount = cashReceived - grandTotal;
  } else if (method === "non-cash") {
    paymentNote = document.getElementById("non-cash-ref-input").value.trim();
  } else if (method === "debt") {
    customerName = document.getElementById("debt-customer-name").value.trim();
    customerPhone = document.getElementById("debt-customer-phone").value.trim();
    if (!customerName) {
      showToast("Masukkan nama pelanggan untuk mencatat kasbon!", "error");
      return;
    }
    cashReceived = 0;
    changeAmount = 0;
  }

  const totalCost = state.cart.reduce((sum, item) => sum + item.cost * item.qty, 0);
  const netProfit = grandTotal - totalCost;
  const nowIso = new Date().toISOString();

  const uniqueSuffix = Math.random().toString(36).slice(2, 4).toUpperCase();
  const newTx = {
    id: `TRX-${Date.now().toString().slice(-6)}-${uniqueSuffix}`,
    timestamp: nowIso,
    cashierId: state.currentUser.id,
    cashierName: state.currentUser.name,
    items: state.cart.map((item) => ({
      ...item,
      itemDiscountAmount: getCartItemDiscountAmount(item),
      netSubtotal: getCartItemNetSubtotal(item)
    })),
    subtotalAmount: calc.subtotalAfterItemDisc,
    cartDiscountAmount: calc.cartDiscountAmount,
    totalAmount: grandTotal,
    totalCost: totalCost,
    netProfit: netProfit,
    paymentMethod: method,
    paymentNote: paymentNote,
    customerName: customerName,
    customerPhone: customerPhone,
    cashReceived: cashReceived,
    changeAmount: changeAmount
  };

  try {
    await db.transaction("rw", db.products, db.transactions, db.debts, async () => {
      // 1. Kurangi stok produk otomatis & tandai produk berubah
      for (const cartItem of state.cart) {
        const prod = await db.products.get(cartItem.productId);
        if (prod) {
          const updatedStock = Math.max(0, prod.stock - cartItem.qty);
          await db.products.update(prod.id, { stock: updatedStock });
          markRecordDirty("products", prod.id);
        }
      }

      // 2. Simpan transaksi & tandai transaksi baru
      await db.transactions.add(newTx);
      markRecordDirty("transactions", newTx.id);

      // 3. Jika Kasbon/Hutang, catat ke tabel debts & tandai baru
      if (method === "debt") {
        const newDebtId = `DBT-${Date.now().toString().slice(-6)}-${uniqueSuffix}`;
        await db.debts.add({
          id: newDebtId,
          transactionId: newTx.id,
          customerName: customerName,
          customerPhone: customerPhone,
          totalAmount: grandTotal,
          paidAmount: 0,
          remainingAmount: grandTotal,
          status: "unpaid",
          cashierId: state.currentUser.id,
          cashierName: state.currentUser.name,
          createdAt: nowIso,
          paymentHistory: []
        });
        markRecordDirty("debts", newDebtId);
      }
    });

    await refreshStateFromDB();
    scheduleCloudSync();

    // Reset keranjang & form pembayaran
    state.cart = [];
    document.getElementById("cart-discount-input").value = "0";
    document.getElementById("cash-received-input").value = "";
    document.getElementById("non-cash-ref-input").value = "";
    document.getElementById("debt-customer-name").value = "";
    document.getElementById("debt-customer-phone").value = "";
    setPaymentMethod("cash");
    resetMobileKasirPane();
    renderKasirProducts();
    renderCart();

    openReceiptModal(newTx);
    showToast(
      method === "debt"
        ? `Kasbon atas nama ${customerName} berhasil dicatat!`
        : "Transaksi selesai & stok diperbarui!",
      "success"
    );
  } catch (err) {
    console.error("Gagal memproses transaksi:", err);
    showToast("Terjadi kesalahan saat menyimpan transaksi.", "error");
  }
}

// ============================================================================
// 4. HALAMAN PRODUK & STOK (CRUD + BARCODE + MIN STOCK + EKSPOR/IMPOR CSV)
// ============================================================================
function renderManageProducts() {
  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  const listEl = document.getElementById("manage-product-list");
  const keyword = document.getElementById("manage-product-search").value.trim().toLowerCase();
  const stockFilter = document.getElementById("manage-stock-filter").value;

  document.getElementById("produk-subtitle").textContent = isAdmin
    ? "Kelola barcode, harga modal, harga jual eceran, stok minimum, serta ekspor/impor CSV."
    : "Daftar harga jual eceran dan ketersediaan stok barang toko.";

  if (isAdmin) {
    const totalSku = state.products.length;
    const totalUnits = state.products.reduce((s, p) => s + p.stock, 0);
    const lowStockCount = state.products.filter((p) => p.stock <= (p.minStock || 0)).length;
    const totalCapital = state.products.reduce((s, p) => s + p.cost * p.stock, 0);

    document.getElementById("stat-total-sku").textContent = `${totalSku} Item`;
    document.getElementById("stat-total-units").textContent = `${totalUnits} pcs`;
    document.getElementById("stat-low-stock").textContent = `${lowStockCount} Item`;
    document.getElementById("stat-total-capital").textContent = formatRupiah(totalCapital);
  }

  const filtered = state.products.filter((p) => {
    const matchText =
      p.name.toLowerCase().includes(keyword) ||
      p.category.toLowerCase().includes(keyword) ||
      (p.barcode || "").toLowerCase().includes(keyword);
    const isLow = p.stock <= (p.minStock || 0);
    const matchStock = stockFilter === "ALL" || (stockFilter === "LOW" && isLow);
    return matchText && matchStock;
  });

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400 font-bold">Tidak ada produk yang cocok.</div>`;
    return;
  }

  filtered.forEach((product) => {
    const margin = product.price - product.cost;
    const minStock = product.minStock ?? 5;
    const isOut = product.stock === 0;
    const isLow = product.stock > 0 && product.stock <= minStock;

    const card = document.createElement("div");
    card.className = `bg-white p-4 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
      isOut ? "border-rose-300 bg-rose-50/20" : isLow ? "border-amber-300 bg-amber-50/20" : "border-slate-200"
    }`;

    if (isAdmin) {
      // Tampilan Admin: Barcode, Harga Modal (HPP), Harga Jual, Margin, Stok, Batas Minimum, Edit & Hapus
      card.innerHTML = `
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">${escapeHtml(product.category)}</span>
            ${
              product.barcode
                ? `<span class="px-2 py-0.5 rounded bg-slate-800 text-white text-[11px] font-mono">${escapeHtml(product.barcode)}</span>`
                : `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px]">Tanpa Barcode</span>`
            }
            <span class="px-2 py-0.5 rounded text-[11px] font-extrabold ${
              isOut
                ? "bg-rose-100 text-rose-700"
                : isLow
                ? "bg-amber-100 text-amber-800"
                : "bg-sky-100 text-sky-700"
            }">
              Stok: ${product.stock} (Min: ${minStock})
            </span>
          </div>
          <h3 class="font-extrabold text-base text-slate-900">${escapeHtml(product.name)}</h3>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
            <span class="text-amber-700 font-bold">Modal: ${formatRupiah(product.cost)}</span>
            <span class="text-slate-900 font-bold">Jual Eceran: ${formatRupiah(product.price)}</span>
            <span class="text-emerald-700 font-extrabold">Laba: ${formatRupiah(margin)}/pcs</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" data-action="edit" class="h-10 px-4 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-extrabold">Edit / Stok</button>
          <button type="button" data-action="delete" class="h-10 px-3.5 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-extrabold">Hapus</button>
        </div>
      `;

      card.querySelector('[data-action="edit"]').addEventListener("click", () => openProductModal(product));
      card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteProduct(product.id));
    } else {
      // Tampilan Kasir: HANYA Barcode, Nama, Kategori, Harga Jual Eceran, dan Stok (Tanpa Harga Modal & Tombol Edit/Hapus)
      card.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">${escapeHtml(product.category)}</span>
            ${
              product.barcode
                ? `<span class="text-[11px] font-mono text-slate-400">${escapeHtml(product.barcode)}</span>`
                : ""
            }
          </div>
          <h3 class="font-extrabold text-base text-slate-900">${escapeHtml(product.name)}</h3>
        </div>
        <div class="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <div class="text-left sm:text-right">
            <p class="text-[11px] font-bold text-slate-400">Harga Jual</p>
            <p class="font-extrabold text-base text-sky-700">${formatRupiah(product.price)}</p>
          </div>
          <div class="px-3.5 py-2 rounded-xl text-center ${
            isOut
              ? "bg-rose-100 text-rose-700"
              : isLow
              ? "bg-amber-100 text-amber-800"
              : "bg-emerald-100 text-emerald-800"
          }">
            <p class="text-[10px] font-bold uppercase">Sisa Stok</p>
            <p class="font-extrabold text-sm">${product.stock}</p>
          </div>
        </div>
      `;
    }

    listEl.appendChild(card);
  });
}

function openProductModal(product = null) {
  if (state.currentUser.role !== "admin") return;

  const modal = document.getElementById("modal-product");
  document.getElementById("modal-product-title").textContent = product ? "Edit Barang & Stok" : "Tambah Barang Baru";
  document.getElementById("prod-id").value = product ? product.id : "";
  document.getElementById("prod-barcode").value = product ? product.barcode || "" : "";
  document.getElementById("prod-name").value = product ? product.name : "";
  document.getElementById("prod-category").value = product ? product.category : "Makanan";
  document.getElementById("prod-cost").value = product ? product.cost : "";
  document.getElementById("prod-price").value = product ? product.price : "";
  document.getElementById("prod-stock").value = product ? product.stock : "";
  document.getElementById("prod-min-stock").value = product ? (product.minStock ?? 5) : 5;

  modal.classList.remove("hidden");

  if (!product) {
    setTimeout(() => {
      document.getElementById("prod-barcode").focus();
    }, 60);
  }
}

function closeProductModal() {
  document.getElementById("modal-product").classList.add("hidden");
}

async function saveProductForm(e) {
  e.preventDefault();
  if (state.currentUser.role !== "admin") return;

  const id = document.getElementById("prod-id").value;
  const barcode = document.getElementById("prod-barcode").value.trim();
  const name = document.getElementById("prod-name").value.trim();
  const category = document.getElementById("prod-category").value.trim() || "Lainnya";
  const cost = Math.max(0, parseInt(document.getElementById("prod-cost").value, 10) || 0);
  const price = Math.max(0, parseInt(document.getElementById("prod-price").value, 10) || 0);
  const stock = Math.max(0, parseInt(document.getElementById("prod-stock").value, 10) || 0);
  const minStock = Math.max(0, parseInt(document.getElementById("prod-min-stock").value, 10) || 0);

  // Cek duplikasi barcode jika diisi
  if (barcode) {
    const duplicate = state.products.find((p) => p.barcode === barcode && p.id !== id);
    if (duplicate) {
      showToast(`Kode barcode sudah dipakai oleh "${duplicate.name}"!`, "error");
      return;
    }
  }

  if (id) {
    await db.products.update(id, { barcode, name, category, cost, price, stock, minStock });
    markRecordDirty("products", id);
    showToast("Data barang berhasil diperbarui!", "success");
  } else {
    const newProdId = "prd_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
    await db.products.add({
      id: newProdId,
      barcode,
      name,
      category,
      cost,
      price,
      stock,
      minStock
    });
    markRecordDirty("products", newProdId);
    showToast("Barang baru berhasil disimpan!", "success");
  }

  await refreshStateFromDB();
  scheduleCloudSync();
  closeProductModal();
  renderManageProducts();
}

async function deleteProduct(productId) {
  if (state.currentUser.role !== "admin") return;
  const target = state.products.find((p) => p.id === productId);
  if (!target) return;

  if (confirm(`Hapus barang "${target.name}" secara permanen?`)) {
    trackDeletedProductId(productId);
    await db.products.delete(productId);
    await refreshStateFromDB();
    scheduleCloudSync();
    renderManageProducts();
    showToast("Barang dihapus dari database.");
  }
}

// ============================================================================
// EKSPOR & IMPOR DATA PRODUK KE CSV / EXCEL (KHUSUS ADMIN)
// ============================================================================
function escapeCsvCell(value) {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportProductsToCSV() {
  if (state.currentUser.role !== "admin") return;

  const headers = [
    "Kode Barcode",
    "Nama Barang",
    "Kategori",
    "Harga Modal",
    "Harga Jual",
    "Jumlah Stok",
    "Batas Stok Minimum"
  ];

  const rows = state.products.map((p) => [
    escapeCsvCell(p.barcode || ""),
    escapeCsvCell(p.name),
    escapeCsvCell(p.category),
    p.cost,
    p.price,
    p.stock,
    p.minStock ?? 5
  ]);

  // Tambahkan UTF-8 BOM (\uFEFF) agar Microsoft Excel langsung membaca kolom dengan rapi
  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `produk-minimarket-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Berhasil mengekspor ${state.products.length} produk ke CSV!`, "success");
}

function downloadSampleCsvTemplate() {
  const sampleLines = [
    "Kode Barcode,Nama Barang,Kategori,Harga Modal,Harga Jual,Jumlah Stok,Batas Stok Minimum",
    "8998866200578,Indomie Goreng Original,Makanan,2600,3500,50,10",
    "8991002101122,Beras Premium Ramos 5kg,Sembako,68000,75000,15,5",
    "8999999034511,Buku Tulis Sidu 38 Lembar,ATK,3200,4500,30,8"
  ];
  const csvContent = "\uFEFF" + sampleLines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "template-produk-minimarket.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseCsvLine(line, delimiter) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function handleCsvFileSelected(e) {
  const file = e.target.files[0];
  const previewBox = document.getElementById("csv-preview-box");
  const confirmBtn = document.getElementById("btn-confirm-import-csv");
  state.pendingCsvRows = [];

  if (!file) {
    previewBox.classList.add("hidden");
    confirmBtn.disabled = true;
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const rawText = event.target.result.replace(/^\uFEFF/, "");
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      showToast("File CSV kosong atau tidak memiliki baris data!", "error");
      previewBox.classList.add("hidden");
      confirmBtn.disabled = true;
      return;
    }

    // Deteksi otomatis pemisah koma (,) atau titik koma (;) dari Excel Indonesia
    const delimiter = lines[0].includes(";") ? ";" : ",";
    const parsedItems = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i], delimiter);
      if (cols.length < 2) continue;

      const barcode = (cols[0] || "").trim();
      const name = (cols[1] || "").trim();
      if (!name) continue;

      const category = (cols[2] || "Lainnya").trim();
      const cost = Math.max(0, parseInt(String(cols[3] || "0").replace(/[^\d]/g, ""), 10) || 0);
      const price = Math.max(0, parseInt(String(cols[4] || "0").replace(/[^\d]/g, ""), 10) || 0);
      const stock = Math.max(0, parseInt(String(cols[5] || "0").replace(/[^\d]/g, ""), 10) || 0);
      const minStock = Math.max(0, parseInt(String(cols[6] || "5").replace(/[^\d]/g, ""), 10) || 5);

      parsedItems.push({ barcode, name, category, cost, price, stock, minStock });
    }

    if (parsedItems.length === 0) {
      showToast("Tidak ada data produk valid yang terbaca dari CSV.", "error");
      previewBox.classList.add("hidden");
      confirmBtn.disabled = true;
      return;
    }

    state.pendingCsvRows = parsedItems;
    previewBox.classList.remove("hidden");
    document.getElementById("csv-preview-summary").textContent = `Siap mengimpor ${parsedItems.length} baris produk.`;
    document.getElementById("csv-preview-detail").textContent = `Contoh: ${parsedItems
      .slice(0, 3)
      .map((item) => item.name)
      .join(", ")}${parsedItems.length > 3 ? ", ..." : ""}`;
    confirmBtn.disabled = false;
  };

  reader.readAsText(file, "UTF-8");
}

async function confirmImportCsvData() {
  if (state.currentUser.role !== "admin" || state.pendingCsvRows.length === 0) return;

  let addedCount = 0;
  let updatedCount = 0;

  try {
    await db.transaction("rw", db.products, async () => {
      const existingProducts = await db.products.toArray();

      for (const row of state.pendingCsvRows) {
        // Cocokkan berdasarkan barcode terlebih dahulu, jika kosong cocokkan nama persis
        const existing = existingProducts.find(
          (p) =>
            (row.barcode && p.barcode === row.barcode) ||
            p.name.toLowerCase() === row.name.toLowerCase()
        );

        if (existing) {
          await db.products.update(existing.id, {
            barcode: row.barcode || existing.barcode,
            name: row.name,
            category: row.category,
            cost: row.cost,
            price: row.price,
            stock: row.stock,
            minStock: row.minStock
          });
          markRecordDirty("products", existing.id);
          const importedId = "prd_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
          updatedCount++;
        } else {
          await db.products.add({
            id: "prd_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            barcode: row.barcode,
            name: row.name,
            category: row.category,
            cost: row.cost,
            price: row.price,
            stock: row.stock,
            minStock: row.minStock
          });
          markRecordDirty("products", importedId);
          addedCount++;
        }
      }
    });

    await refreshStateFromDB();
    scheduleCloudSync();
    closeImportCsvModal();
    renderManageProducts();
    showToast(`Impor selesai: ${addedCount} baru, ${updatedCount} diperbarui!`, "success");
  } catch (err) {
    console.error("Gagal impor CSV:", err);
    showToast("Terjadi kesalahan saat mengimpor CSV.", "error");
  }
}

function openImportCsvModal() {
  if (state.currentUser.role !== "admin") return;
  state.pendingCsvRows = [];
  document.getElementById("csv-file-input").value = "";
  document.getElementById("csv-preview-box").classList.add("hidden");
  document.getElementById("btn-confirm-import-csv").disabled = true;
  document.getElementById("modal-import-csv").classList.remove("hidden");
}

function closeImportCsvModal() {
  document.getElementById("modal-import-csv").classList.add("hidden");
}

// ============================================================================
// 5. HALAMAN RIWAYAT TRANSAKSI (ADMIN: SEMUA + LABA | KASIR: MILIK SENDIRI)
// ============================================================================
// ============================================================================
// 5. LAPORAN & RIWAYAT (FILTER WAKTU/KASIR, RETUR PIN ADMIN, & BUKU KASBON)
// ============================================================================
let riwayatPeriodFilter = "TODAY"; // "TODAY" | "YESTERDAY" | "THIS_MONTH" | "CUSTOM" | "ALL"
let activeDetailTxId = null;

function setRiwayatPeriodFilter(period) {
  riwayatPeriodFilter = period;

  document.querySelectorAll(".period-filter-btn").forEach((btn) => {
    const active = btn.dataset.period === period;
    btn.className = active
      ? "period-filter-btn px-3.5 py-2 rounded-xl bg-sky-600 text-white text-xs font-extrabold transition"
      : "period-filter-btn px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-extrabold transition";
  });

  const customDateBox = document.getElementById("riwayat-custom-date-box");
  if (period === "CUSTOM") {
    customDateBox.classList.remove("hidden");
    const todayStr = new Date().toISOString().slice(0, 10);
    const startInput = document.getElementById("riwayat-date-start");
    const endInput = document.getElementById("riwayat-date-end");
    if (!startInput.value) startInput.value = todayStr;
    if (!endInput.value) endInput.value = todayStr;
  } else {
    customDateBox.classList.add("hidden");
  }

  renderHistoryView();
}

function matchesPeriodFilter(isoTimestamp) {
  if (riwayatPeriodFilter === "ALL") return true;

  const txDate = new Date(isoTimestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (riwayatPeriodFilter === "TODAY") {
    return txDate >= startOfToday;
  }

  if (riwayatPeriodFilter === "YESTERDAY") {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    return txDate >= startOfYesterday && txDate < startOfToday;
  }

  if (riwayatPeriodFilter === "THIS_MONTH") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return txDate >= startOfMonth;
  }

  if (riwayatPeriodFilter === "CUSTOM") {
    const startVal = document.getElementById("riwayat-date-start").value;
    const endVal = document.getElementById("riwayat-date-end").value;
    if (startVal) {
      const [sy, sm, sd] = startVal.split("-").map(Number);
      const startBound = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      if (txDate < startBound) return false;
    }
    if (endVal) {
      const [ey, em, ed] = endVal.split("-").map(Number);
      const endBound = new Date(ey, em - 1, ed, 23, 59, 59, 999);
      if (txDate > endBound) return false;
    }
    return true;
  }

  return true;
}

function getPaymentMethodBadge(method) {
  if (method === "non-cash") {
    return `<span class="px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-extrabold uppercase">QRIS / Transfer</span>`;
  }
  if (method === "debt") {
    return `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase">Kasbon</span>`;
  }
  return `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase">Tunai</span>`;
}

function renderHistoryView() {
  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  const kpiGrid = document.getElementById("riwayat-kpi-grid");
  const listEl = document.getElementById("transaction-history-list");
  const filterSelect = document.getElementById("riwayat-cashier-filter");

  // Update badge jumlah kasbon belum lunas di tombol pintasan
  const unpaidDebtsCount = state.debts.filter((d) => d.status !== "paid" && d.status !== "voided").length;
  document.getElementById("riwayat-unpaid-debt-count").textContent = unpaidDebtsCount;

  document.getElementById("riwayat-title").textContent = isAdmin
    ? "Laporan Keuangan & Riwayat Transaksi"
    : `Laporan Shift & Riwayat (${state.currentUser.name})`;
  document.getElementById("riwayat-subtitle").textContent = isAdmin
    ? "Pantau omzet, modal (HPP), laba bersih, dan kecocokan setoran kasir."
    : "Ringkasan uang tunai yang harus disetor dan transaksi shift Anda.";

  // Filter berdasarkan Role & Dropdown Kasir
  let roleScopedTx = [];
  if (isAdmin) {
    const selectedCashier = filterSelect.value || "ALL";
    filterSelect.innerHTML = `<option value="ALL">Semua Kasir (Aktif &amp; Nonaktif)</option>`;
    state.users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.status === "inactive" ? `${u.name} (Nonaktif)` : u.name;
      filterSelect.appendChild(opt);
    });
    filterSelect.value = selectedCashier;

    roleScopedTx =
      selectedCashier === "ALL"
        ? state.transactions
        : state.transactions.filter((t) => t.cashierId === selectedCashier);
  } else {
    roleScopedTx = state.transactions.filter((t) => t.cashierId === state.currentUser.id);
  }

  // Filter berdasarkan Periode Waktu
  const filteredTx = roleScopedTx.filter((t) => matchesPeriodFilter(t.timestamp));
  const validTx = filteredTx.filter((t) => t.status !== "voided");
  const voidedCount = filteredTx.length - validTx.length;

  document.getElementById("riwayat-list-count-label").textContent = `${filteredTx.length} transaksi (${voidedCount} retur)`;

  // Hitung metrik keuangan dari transaksi yang valid (bukan retur)
  const totalOmzet = validTx.reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalModal = validTx.reduce((s, t) => s + (Number(t.totalCost) || 0), 0);
  const totalLaba = validTx.reduce((s, t) => s + (Number(t.netProfit) || 0), 0);

  const totalTunai = validTx
    .filter((t) => (t.paymentMethod || "cash") === "cash")
    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalNonTunai = validTx
    .filter((t) => t.paymentMethod === "non-cash")
    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalKasbonBaru = validTx
    .filter((t) => t.paymentMethod === "debt")
    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);

  if (isAdmin) {
    // TAMPILAN ADMIN: Omzet, Modal (HPP), Laba Bersih, Tunai vs Non-Tunai, & Jumlah Transaksi
    kpiGrid.innerHTML = `
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p class="text-xs font-bold text-slate-400 uppercase">Total Omzet (Penjualan)</p>
        <p class="text-2xl font-extrabold text-sky-700 mt-1">${formatRupiah(totalOmzet)}</p>
        ${totalKasbonBaru > 0 ? `<p class="text-[11px] font-bold text-amber-700 mt-1">Termasuk Kasbon: ${formatRupiah(totalKasbonBaru)}</p>` : ""}
      </div>
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p class="text-xs font-bold text-slate-400 uppercase">Total Modal (HPP)</p>
        <p class="text-2xl font-extrabold text-amber-600 mt-1">${formatRupiah(totalModal)}</p>
      </div>
      <div class="bg-emerald-600 text-white p-4 rounded-2xl shadow-sm">
        <p class="text-xs font-bold text-emerald-100 uppercase">Laba Bersih</p>
        <p class="text-2xl font-extrabold mt-1">${formatRupiah(totalLaba)}</p>
      </div>
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm sm:col-span-2">
        <p class="text-xs font-bold text-slate-400 uppercase mb-1.5">Perbandingan Tunai vs Non-Tunai</p>
        <div class="grid grid-cols-2 gap-3">
          <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <p class="text-[11px] font-bold text-emerald-800">Uang Tunai (Laci)</p>
            <p class="text-base md:text-lg font-extrabold text-emerald-700">${formatRupiah(totalTunai)}</p>
          </div>
          <div class="p-2.5 rounded-xl bg-sky-50 border border-sky-200">
            <p class="text-[11px] font-bold text-sky-800">QRIS / Transfer</p>
            <p class="text-base md:text-lg font-extrabold text-sky-700">${formatRupiah(totalNonTunai)}</p>
          </div>
        </div>
      </div>
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p class="text-xs font-bold text-slate-400 uppercase">Jumlah Transaksi</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">${validTx.length} Struk</p>
        ${voidedCount > 0 ? `<p class="text-[11px] font-bold text-rose-600 mt-1">${voidedCount} transaksi dibatalkan/retur</p>` : ""}
      </div>
    `;
  } else {
    // TAMPILAN KASIR: Sembunyikan Modal & Laba Bersih -> Fokus Uang Tunai Wajib Disetor, Non-Tunai, & Jumlah Transaksi
    kpiGrid.innerHTML = `
      <div class="bg-emerald-600 text-white p-4 rounded-2xl shadow-sm">
        <p class="text-xs font-bold text-emerald-100 uppercase">Total Uang Tunai (Wajib Disetor)</p>
        <p class="text-2xl font-extrabold mt-1">${formatRupiah(totalTunai)}</p>
        <p class="text-[11px] text-emerald-100 mt-1">Cocokkan dengan uang fisik di laci kasir</p>
      </div>
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p class="text-xs font-bold text-slate-400 uppercase">Total Non-Tunai (QRIS / Transfer)</p>
        <p class="text-2xl font-extrabold text-sky-700 mt-1">${formatRupiah(totalNonTunai)}</p>
        ${totalKasbonBaru > 0 ? `<p class="text-[11px] font-bold text-amber-700 mt-1">Kasbon Tercatat: ${formatRupiah(totalKasbonBaru)}</p>` : ""}
      </div>
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <p class="text-xs font-bold text-slate-400 uppercase">Jumlah Transaksi Saya</p>
        <p class="text-2xl font-extrabold text-slate-900 mt-1">${validTx.length} Struk</p>
        ${voidedCount > 0 ? `<p class="text-[11px] font-bold text-rose-600 mt-1">${voidedCount} transaksi diretur</p>` : ""}
      </div>
    `;
  }

  // Render Daftar Riwayat Transaksi
  listEl.innerHTML = "";
  if (filteredTx.length === 0) {
    listEl.innerHTML = `
      <div class="bg-white p-10 rounded-2xl border border-slate-200 text-center text-slate-400 font-bold">
        Tidak ada transaksi pada periode atau filter yang dipilih.
      </div>
    `;
    return;
  }

  filteredTx.forEach((tx) => {
    const isVoided = tx.status === "voided";
    const dateStr = new Date(tx.timestamp).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    const card = document.createElement("div");
    card.className = `p-4 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition cursor-pointer ${
      isVoided
        ? "bg-rose-50/40 border-rose-200 opacity-85"
        : "bg-white border-slate-200 hover:border-sky-400"
    }`;

    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-extrabold text-sm text-slate-900 ${isVoided ? "line-through text-rose-700" : ""}">#${escapeHtml(tx.id)}</span>
          ${getPaymentMethodBadge(tx.paymentMethod)}
          ${
            isVoided
              ? `<span class="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold uppercase">Dibatalkan / Retur</span>`
              : ""
          }
          <span class="text-xs text-slate-500">• ${dateStr}</span>
        </div>
        <p class="text-xs text-slate-600">
          Kasir: <strong>${escapeHtml(tx.cashierName)}</strong> • ${tx.items.length} jenis barang
          ${tx.customerName ? ` • Pelanggan: <strong>${escapeHtml(tx.customerName)}</strong>` : ""}
        </p>
        <div class="flex flex-wrap gap-3 pt-0.5 text-xs">
          <span class="font-extrabold ${isVoided ? "line-through text-slate-400" : "text-sky-700"}">
            Total: ${formatRupiah(tx.totalAmount)}
          </span>
          ${
            isAdmin && !isVoided
              ? `<span class="font-extrabold text-emerald-700">Laba Bersih: ${formatRupiah(tx.netProfit)}</span>`
              : ""
          }
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button type="button" data-action="detail" class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold">
          Detail / Retur
        </button>
        <button type="button" data-action="reprint" class="h-10 px-3.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-extrabold">
          Struk
        </button>
      </div>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="reprint"]')) {
        openReceiptModal(tx);
      } else {
        openTxDetailModal(tx.id);
      }
    });

    listEl.appendChild(card);
  });
}

// ============================================================================
// EKSPOR LAPORAN TRANSAKSI, OMZET, & LABA KE CSV / EXCEL (RENTANG TANGGAL)
// ============================================================================
function toLocalDateInputString(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function applyExportDatePreset(preset) {
  const now = new Date();
  const startInput = document.getElementById("export-date-start");
  const endInput = document.getElementById("export-date-end");

  if (preset === "TODAY") {
    const today = toLocalDateInputString(now);
    startInput.value = today;
    endInput.value = today;
  } else if (preset === "YESTERDAY") {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yStr = toLocalDateInputString(yesterday);
    startInput.value = yStr;
    endInput.value = yStr;
  } else if (preset === "THIS_MONTH") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    startInput.value = toLocalDateInputString(firstDay);
    endInput.value = toLocalDateInputString(now);
  } else if (preset === "ALL") {
    startInput.value = "";
    endInput.value = "";
  }

  updateExportReportPreview();
}

function openExportReportModal() {
  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  const cashierWrapper = document.getElementById("export-cashier-wrapper");
  const cashierSelect = document.getElementById("export-cashier-select");

  if (isAdmin) {
    cashierWrapper.classList.remove("hidden");
    const currentFilter = document.getElementById("riwayat-cashier-filter").value || "ALL";
    cashierSelect.innerHTML = `<option value="ALL">Semua Kasir (Aktif &amp; Nonaktif)</option>`;
    state.users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.status === "inactive" ? `${u.name} (Nonaktif)` : u.name;
      cashierSelect.appendChild(opt);
    });
    cashierSelect.value = currentFilter;
  } else {
    cashierWrapper.classList.add("hidden");
  }

  // Selaraskan tanggal awal modal ekspor dengan filter yang sedang aktif di halaman Laporan
  if (riwayatPeriodFilter === "CUSTOM") {
    document.getElementById("export-date-start").value = document.getElementById("riwayat-date-start").value || "";
    document.getElementById("export-date-end").value = document.getElementById("riwayat-date-end").value || "";
  } else {
    applyExportDatePreset(riwayatPeriodFilter);
  }

  updateExportReportPreview();
  document.getElementById("modal-export-report").classList.remove("hidden");
}

function closeExportReportModal() {
  document.getElementById("modal-export-report").classList.add("hidden");
}

function getFilteredTransactionsForExport() {
  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  const startVal = document.getElementById("export-date-start").value;
  const endVal = document.getElementById("export-date-end").value;
  const selectedCashier = isAdmin
    ? document.getElementById("export-cashier-select").value
    : state.currentUser.id;

  let startBound = null;
  let endBound = null;

  if (startVal) {
    const [sy, sm, sd] = startVal.split("-").map(Number);
    startBound = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
  }
  if (endVal) {
    const [ey, em, ed] = endVal.split("-").map(Number);
    endBound = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  }

  const matched = state.transactions
    .filter((tx) => {
      if (selectedCashier !== "ALL" && tx.cashierId !== selectedCashier) return false;
      const txDate = new Date(tx.timestamp);
      if (startBound && txDate < startBound) return false;
      if (endBound && txDate > endBound) return false;
      return true;
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return { matched, startVal, endVal, selectedCashier, isAdmin };
}

function updateExportReportPreview() {
  const { matched, isAdmin } = getFilteredTransactionsForExport();
  const validTx = matched.filter((t) => t.status !== "voided");
  const voidCount = matched.length - validTx.length;

  const totalOmzet = validTx.reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalLaba = validTx.reduce((s, t) => s + (Number(t.netProfit) || 0), 0);

  const countEl = document.getElementById("export-preview-count");
  const totalsEl = document.getElementById("export-preview-totals");
  const submitBtn = document.getElementById("btn-confirm-export-report");

  if (matched.length === 0) {
    countEl.textContent = "Tidak ada transaksi pada rentang tanggal ini.";
    totalsEl.textContent = "Silakan ubah tanggal mulai atau tanggal akhir.";
    submitBtn.disabled = true;
    submitBtn.classList.add("opacity-50");
    return;
  }

  submitBtn.disabled = false;
  submitBtn.classList.remove("opacity-50");
  countEl.textContent = `Ditemukan ${validTx.length} transaksi valid${voidCount > 0 ? ` (${voidCount} retur)` : ""}`;
  totalsEl.textContent = isAdmin
    ? `Total Omzet: ${formatRupiah(totalOmzet)} | Laba Bersih: ${formatRupiah(totalLaba)}`
    : `Total Penjualan: ${formatRupiah(totalOmzet)}`;
}

function handleExportReportSubmit(e) {
  e.preventDefault();
  const { matched, startVal, endVal, selectedCashier, isAdmin } = getFilteredTransactionsForExport();

  if (matched.length === 0) {
    showToast("Tidak ada transaksi untuk diekspor pada tanggal tersebut.", "error");
    return;
  }

  const validTx = matched.filter((t) => t.status !== "voided");
  const voidedTx = matched.filter((t) => t.status === "voided");

  const totalOmzet = validTx.reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalModal = validTx.reduce((s, t) => s + (Number(t.totalCost) || 0), 0);
  const totalLaba = validTx.reduce((s, t) => s + (Number(t.netProfit) || 0), 0);
  const totalDiskon = validTx.reduce((s, t) => {
    const itemDisc = (t.items || []).reduce((acc, it) => acc + (Number(it.itemDiscountAmount) || 0), 0);
    return s + itemDisc + (Number(t.cartDiscountAmount) || 0);
  }, 0);

  const totalTunai = validTx
    .filter((t) => (t.paymentMethod || "cash") === "cash")
    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalNonTunai = validTx
    .filter((t) => t.paymentMethod === "non-cash")
    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);
  const totalKasbon = validTx
    .filter((t) => t.paymentMethod === "debt")
    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0);

  const periodeLabel =
    startVal && endVal
      ? `${startVal} s/d ${endVal}`
      : startVal
      ? `Mulai ${startVal}`
      : endVal
      ? `Sampai ${endVal}`
      : "Semua Waktu";

  let kasirLabel = "Semua Kasir";
  if (!isAdmin) {
    kasirLabel = state.currentUser.name;
  } else if (selectedCashier !== "ALL") {
    const foundUser = state.users.find((u) => u.id === selectedCashier);
    kasirLabel = foundUser ? foundUser.name : selectedCashier;
  }

  const csvLines = [];

  // BLOK 1: RINGKASAN LAPORAN KEUANGAN
  csvLines.push([escapeCsvCell(`LAPORAN TRANSAKSI - ${(state.receiptConfig.storeName || "MINIMARKET").toUpperCase()}`)]);
  csvLines.push(["Periode Laporan", escapeCsvCell(periodeLabel)]);
  csvLines.push(["Filter Kasir", escapeCsvCell(kasirLabel)]);
  csvLines.push(["Diekspor Oleh", escapeCsvCell(`${state.currentUser.name} (${state.currentUser.role.toUpperCase()})`)]);
  csvLines.push(["Waktu Ekspor", escapeCsvCell(new Date().toLocaleString("id-ID"))]);
  csvLines.push([]);
  csvLines.push(["RINGKASAN KEUANGAN", "NILAI"]);
  csvLines.push(["Jumlah Transaksi Valid", validTx.length]);
  csvLines.push(["Jumlah Transaksi Batal / Retur", voidedTx.length]);
  csvLines.push(["Total Pembayaran Tunai", totalTunai]);
  csvLines.push(["Total Pembayaran Non-Tunai (QRIS/Transfer)", totalNonTunai]);
  csvLines.push(["Total Transaksi Kasbon / Hutang", totalKasbon]);
  csvLines.push(["Total Diskon Diberikan", totalDiskon]);
  csvLines.push(["TOTAL OMZET (PENJUALAN BERSIH)", totalOmzet]);

  if (isAdmin) {
    csvLines.push(["TOTAL MODAL (HPP)", totalModal]);
    csvLines.push(["TOTAL LABA BERSIH", totalLaba]);
  }

  csvLines.push([]);

  // BLOK 2: TABEL RINCIAN TRANSAKSI
  const tableHeaders = [
    "No. Nota",
    "Tanggal & Waktu",
    "Kasir",
    "Pelanggan",
    "Metode Pembayaran",
    "Status",
    "Rincian Barang",
    "Subtotal Kotor",
    "Total Diskon",
    "Total Omzet"
  ];
  if (isAdmin) {
    tableHeaders.push("Total Modal (HPP)", "Laba Bersih");
  }
  csvLines.push(tableHeaders.join(","));

  matched.forEach((tx) => {
    const isVoided = tx.status === "voided";
    const dtStr = new Date(tx.timestamp).toLocaleString("id-ID");
    const methodLabel =
      tx.paymentMethod === "non-cash"
        ? "QRIS / Transfer"
        : tx.paymentMethod === "debt"
        ? "Kasbon / Hutang"
        : "Tunai";
    const statusLabel = isVoided ? `DIBATALKAN / RETUR (${tx.voidReason || "-"})` : "SELESAI";

    const itemsSummary = (tx.items || [])
      .map((it) => `${it.name} (${it.qty}x @${it.price})`)
      .join("; ");

    const itemDiscSum = (tx.items || []).reduce((acc, it) => acc + (Number(it.itemDiscountAmount) || 0), 0);
    const totalTxDiscount = itemDiscSum + (Number(tx.cartDiscountAmount) || 0);
    const grossSubtotal = (Number(tx.totalAmount) || 0) + totalTxDiscount;

    // Jika transaksi dibatalkan/retur, isi angka keuangan 0 agar rumus =SUM() di Excel akurat
    const rowCols = [
      escapeCsvCell(tx.id),
      escapeCsvCell(dtStr),
      escapeCsvCell(tx.cashierName || ""),
      escapeCsvCell(tx.customerName || "-"),
      escapeCsvCell(methodLabel),
      escapeCsvCell(statusLabel),
      escapeCsvCell(
        isVoided
          ? `${itemsSummary} [Nilai Batal: ${formatRupiah(tx.totalAmount)}]`
          : itemsSummary
      ),
      isVoided ? 0 : grossSubtotal,
      isVoided ? 0 : totalTxDiscount,
      isVoided ? 0 : Number(tx.totalAmount) || 0
    ];

    if (isAdmin) {
      rowCols.push(isVoided ? 0 : Number(tx.totalCost) || 0);
      rowCols.push(isVoided ? 0 : Number(tx.netProfit) || 0);
    }

    csvLines.push(rowCols.join(","));
  });

  // Format baris ringkasan menjadi string CSV valid
  const formattedLines = csvLines.map((line) => (Array.isArray(line) ? line.join(",") : line));
  const csvContent = "\uFEFF" + formattedLines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const fileRangeTag =
    startVal && endVal
      ? `${startVal}_sd_${endVal}`
      : startVal || endVal || new Date().toISOString().slice(0, 10);

  const link = document.createElement("a");
  link.href = url;
  link.download = `laporan-transaksi-${fileRangeTag}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  closeExportReportModal();
  showToast(`Laporan (${validTx.length} transaksi) berhasil diunduh!`, "success");
}

// ============================================================================
// DETAIL TRANSAKSI & PEMBATALAN / RETUR DENGAN PIN ADMIN
// ============================================================================
function openTxDetailModal(txId) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;

  activeDetailTxId = tx.id;
  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  const isVoided = tx.status === "voided";

  document.getElementById("tx-detail-title").textContent = `Nota #${tx.id}`;
  document.getElementById("tx-detail-subtitle").textContent = `${new Date(tx.timestamp).toLocaleString("id-ID")} • Kasir: ${tx.cashierName}`;

  const voidBtn = document.getElementById("btn-tx-detail-void");
  voidBtn.classList.toggle("hidden", isVoided);

  const itemsHtml = tx.items
    .map((item) => {
      const sub = item.netSubtotal != null ? item.netSubtotal : item.qty * item.price;
      return `
        <div class="flex items-center justify-between py-2 border-b border-slate-100 text-xs">
          <div>
            <p class="font-bold text-slate-900">${escapeHtml(item.name)}</p>
            <p class="text-slate-500">${item.qty} x ${formatRupiah(item.price)} ${
              item.itemDiscountAmount > 0 ? `(Diskon -${formatRupiah(item.itemDiscountAmount)})` : ""
            }</p>
          </div>
          <span class="font-extrabold text-slate-800">${formatRupiah(sub)}</span>
        </div>
      `;
    })
    .join("");

  document.getElementById("tx-detail-body").innerHTML = `
    ${
      isVoided
        ? `<div class="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1">
            <p class="font-extrabold uppercase">Transaksi Telah Dibatalkan / Diretur</p>
            <p>Waktu Retur: ${new Date(tx.voidedAt).toLocaleString("id-ID")}</p>
            <p>Disetujui Admin: <strong>${escapeHtml(tx.voidedBy || "-")}</strong></p>
            <p>Alasan: ${escapeHtml(tx.voidReason || "-")}</p>
          </div>`
        : ""
    }
    <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
      <div class="flex justify-between">
        <span class="text-slate-500">Metode Pembayaran</span>
        <span>${getPaymentMethodBadge(tx.paymentMethod)}</span>
      </div>
      ${
        tx.customerName
          ? `<div class="flex justify-between"><span class="text-slate-500">Pelanggan</span><strong class="text-slate-900">${escapeHtml(tx.customerName)}</strong></div>`
          : ""
      }
      <div class="flex justify-between">
        <span class="text-slate-500">Total Tagihan</span>
        <strong class="text-sky-700 text-sm">${formatRupiah(tx.totalAmount)}</strong>
      </div>
      ${
        isAdmin
          ? `<div class="flex justify-between"><span class="text-slate-500">Laba Bersih</span><strong class="text-emerald-700">${formatRupiah(tx.netProfit)}</strong></div>`
          : ""
      }
    </div>
    <div>
      <p class="text-xs font-extrabold uppercase text-slate-400 mb-1">Rincian Barang (${tx.items.length} item)</p>
      <div class="divide-y divide-slate-100">${itemsHtml}</div>
    </div>
  `;

  document.getElementById("modal-tx-detail").classList.remove("hidden");
}

function closeTxDetailModal() {
  document.getElementById("modal-tx-detail").classList.add("hidden");
}

function openVoidAuthModal() {
  const tx = state.transactions.find((t) => t.id === activeDetailTxId);
  if (!tx || tx.status === "voided") return;

  document.getElementById("void-tx-info-box").innerHTML = `
    <p>Nota: <strong>#${escapeHtml(tx.id)}</strong> • Total: <strong>${formatRupiah(tx.totalAmount)}</strong></p>
    <p>Semua stok barang pada transaksi ini akan <strong>otomatis dikembalikan</strong> ke gudang/etalase.</p>
  `;
  document.getElementById("void-reason-input").value = "";
  document.getElementById("void-admin-pin-input").value = "";
  document.getElementById("modal-void-auth").classList.remove("hidden");

  setTimeout(() => {
    document.getElementById("void-reason-input").focus();
  }, 60);
}

function closeVoidAuthModal() {
  document.getElementById("modal-void-auth").classList.add("hidden");
}

async function handleConfirmVoidTransaction(e) {
  e.preventDefault();
  const tx = state.transactions.find((t) => t.id === activeDetailTxId);
  if (!tx || tx.status === "voided") return;

  const reason = document.getElementById("void-reason-input").value.trim();
  const enteredPin = document.getElementById("void-admin-pin-input").value.trim();

  // Verifikasi PIN terhadap seluruh akun Admin yang aktif
  const authorizingAdmin = state.users.find(
    (u) => u.role === "admin" && u.status === "active" && u.pin === enteredPin
  );

  if (!authorizingAdmin) {
    showToast("PIN Admin salah atau tidak memiliki hak akses Admin!", "error");
    document.getElementById("void-admin-pin-input").value = "";
    document.getElementById("void-admin-pin-input").focus();
    return;
  }

  try {
    await db.transaction("rw", db.products, db.transactions, db.debts, async () => {
      // 1. Kembalikan stok setiap barang pada transaksi ini
      for (const item of tx.items) {
        const prod = await db.products.get(item.productId);
        if (prod) {
          await db.products.update(prod.id, { stock: prod.stock + item.qty });
          markRecordDirty("products", prod.id);
        }
      }

      // 2. Tandai transaksi sebagai dibatalkan/retur
      await db.transactions.update(tx.id, {
        status: "voided",
        voidedAt: new Date().toISOString(),
        voidedBy: authorizingAdmin.name,
        voidReason: reason
      });
      markRecordDirty("transactions", tx.id);

      // 3. Jika transaksi ini adalah Kasbon, batalkan juga tagihan kasbonnya
      if (tx.paymentMethod === "debt") {
        const linkedDebt = await db.debts.where("transactionId").equals(tx.id).first();
        if (linkedDebt) {
          await db.debts.update(linkedDebt.id, {
            status: "voided",
            remainingAmount: 0
          });
          markRecordDirty("debts", linkedDebt.id);
        }
      }
    });

    await refreshStateFromDB();
    scheduleCloudSync();
    closeVoidAuthModal();
    closeTxDetailModal();
    renderHistoryView();
    showToast(`Transaksi #${tx.id} dibatalkan & stok dikembalikan!`, "success");
  } catch (err) {
    console.error("Gagal retur transaksi:", err);
    showToast("Terjadi kesalahan saat membatalkan transaksi.", "error");
  }
}

// ============================================================================
// MENU BUKU KASBON / PIUTANG PELANGGAN (CICILAN & PELUNASAN)
// ============================================================================
function renderDebtsView() {
  const listEl = document.getElementById("debts-list-container");
  const keyword = document.getElementById("debt-search-input").value.trim().toLowerCase();
  const statusFilter = document.getElementById("debt-status-filter").value;

  const activeDebts = state.debts.filter((d) => d.status !== "voided");
  const totalRemaining = activeDebts
    .filter((d) => d.status !== "paid")
    .reduce((s, d) => s + (Number(d.remainingAmount) || 0), 0);
  const unpaidCount = activeDebts.filter((d) => d.status !== "paid").length;
  const totalPaid = activeDebts.reduce((s, d) => s + (Number(d.paidAmount) || 0), 0);

  document.getElementById("debt-stat-remaining").textContent = formatRupiah(totalRemaining);
  document.getElementById("debt-stat-unpaid-count").textContent = `${unpaidCount} Nota`;
  document.getElementById("debt-stat-paid-total").textContent = formatRupiah(totalPaid);

  const filtered = activeDebts
    .filter((d) => {
      const matchText =
        (d.customerName || "").toLowerCase().includes(keyword) ||
        (d.customerPhone || "").toLowerCase().includes(keyword) ||
        (d.transactionId || "").toLowerCase().includes(keyword);
      const isPaid = d.status === "paid";
      const matchStatus =
        statusFilter === "ALL" ||
        (statusFilter === "UNPAID" && !isPaid) ||
        (statusFilter === "PAID" && isPaid);
      return matchText && matchStatus;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  listEl.innerHTML = "";
  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="bg-white p-10 rounded-2xl border border-slate-200 text-center text-slate-400 font-bold">
        Tidak ada catatan kasbon pada filter ini.
      </div>
    `;
    return;
  }

  filtered.forEach((debt) => {
    const isPaid = debt.status === "paid";
    const isPartial = debt.paidAmount > 0 && !isPaid;
    const dateStr = new Date(debt.createdAt).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

    const card = document.createElement("div");
    card.className = `p-4 rounded-2xl border shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
      isPaid ? "bg-slate-50 border-slate-200" : "bg-white border-amber-200"
    }`;

    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-extrabold text-base text-slate-900">${escapeHtml(debt.customerName)}</h3>
          ${
            isPaid
              ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase">Lunas</span>`
              : isPartial
              ? `<span class="px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-extrabold uppercase">Cicilan</span>`
              : `<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold uppercase">Belum Lunas</span>`
          }
          <span class="text-xs text-slate-400">• ${dateStr} • #${escapeHtml(debt.transactionId || debt.id)}</span>
        </div>
        ${debt.customerPhone ? `<p class="text-xs text-slate-500">HP/WA: ${escapeHtml(debt.customerPhone)}</p>` : ""}
        ${debt.note ? `<p class="text-xs text-slate-500 italic">Catatan: ${escapeHtml(debt.note)}</p>` : ""}
        <div class="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
          <span class="text-slate-600">Total Hutang: <strong>${formatRupiah(debt.totalAmount)}</strong></span>
          <span class="text-emerald-700">Sudah Dibayar: <strong>${formatRupiah(debt.paidAmount)}</strong></span>
          <span class="text-rose-700 font-extrabold">Sisa Hutang: ${formatRupiah(debt.remainingAmount)}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 shrink-0">
        ${
          !isPaid
            ? `<button type="button" data-action="pay" class="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs">
                Catat Cicilan / Lunas
              </button>`
            : ""
        }
        ${
          debt.transactionId && !String(debt.transactionId).startsWith("MANUAL")
            ? `<button type="button" data-action="receipt" class="h-10 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold">
                Lihat Nota
              </button>`
            : ""
        }
        ${
          !isPaid
            ? `<button type="button" data-action="remind-wa" class="h-10 px-3.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-extrabold">
                Kirim Info WA
              </button>`
            : ""
        }
      </div>
    `;

    const payBtn = card.querySelector('[data-action="pay"]');
    if (payBtn) payBtn.addEventListener("click", () => openDebtPaymentModal(debt.id));

    const receiptBtn = card.querySelector('[data-action="receipt"]');
    if (receiptBtn) {
      receiptBtn.addEventListener("click", () => {
        const tx = state.transactions.find((t) => t.id === debt.transactionId);
        if (tx) openReceiptModal(tx);
      });
    }

    const remindBtn = card.querySelector('[data-action="remind-wa"]');
    if (remindBtn) {
      remindBtn.addEventListener("click", () => sendDebtReminderWhatsApp(debt));
    }

    listEl.appendChild(card);
  });
}

function openDebtPaymentModal(debtId) {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt || debt.status === "paid") return;

  document.getElementById("pay-debt-id").value = debt.id;
  document.getElementById("pay-debt-summary").innerHTML = `
    <p class="font-extrabold text-sm">${escapeHtml(debt.customerName)}</p>
    <p>Total Hutang: <strong>${formatRupiah(debt.totalAmount)}</strong> • Sudah Dibayar: <strong>${formatRupiah(debt.paidAmount)}</strong></p>
    <p class="text-rose-700 font-extrabold mt-1">Sisa Tagihan: ${formatRupiah(debt.remainingAmount)}</p>
  `;
  document.getElementById("pay-debt-amount").value = debt.remainingAmount;
  document.getElementById("pay-debt-amount").max = debt.remainingAmount;
  document.getElementById("pay-debt-note").value = "";
  document.getElementById("modal-debt-payment").classList.remove("hidden");
}

function closeDebtPaymentModal() {
  document.getElementById("modal-debt-payment").classList.add("hidden");
}

async function handleSaveDebtPayment(e) {
  e.preventDefault();
  const debtId = document.getElementById("pay-debt-id").value;
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return;

  const payAmount = Math.max(0, Number(document.getElementById("pay-debt-amount").value) || 0);
  if (payAmount <= 0 || payAmount > debt.remainingAmount) {
    showToast("Nominal pembayaran tidak valid atau melebihi sisa hutang!", "error");
    return;
  }

  const method = document.getElementById("pay-debt-method").value;
  const note = document.getElementById("pay-debt-note").value.trim();

  const newPaidAmount = (Number(debt.paidAmount) || 0) + payAmount;
  const newRemaining = Math.max(0, (Number(debt.totalAmount) || 0) - newPaidAmount);
  const newStatus = newRemaining === 0 ? "paid" : "partial";

  const history = Array.isArray(debt.paymentHistory) ? [...debt.paymentHistory] : [];
  history.push({
    date: new Date().toISOString(),
    amount: payAmount,
    method,
    note,
    receivedBy: state.currentUser.name
  });

  await db.debts.update(debt.id, {
    paidAmount: newPaidAmount,
    remainingAmount: newRemaining,
    status: newStatus,
    paymentHistory: history
  });
  markRecordDirty("debts", debt.id);

  await refreshStateFromDB();
  scheduleCloudSync();
  closeDebtPaymentModal();
  renderDebtsView();
  showToast(
    newStatus === "paid"
      ? `Kasbon ${debt.customerName} telah LUNAS!`
      : `Cicilan ${formatRupiah(payAmount)} berhasil dicatat!`,
    "success"
  );
}

function openManualDebtModal() {
  document.getElementById("form-manual-debt").reset();
  document.getElementById("modal-add-manual-debt").classList.remove("hidden");
}

function closeManualDebtModal() {
  document.getElementById("modal-add-manual-debt").classList.add("hidden");
}

async function handleSaveManualDebt(e) {
  e.preventDefault();
  const name = document.getElementById("manual-debt-name").value.trim();
  const phone = document.getElementById("manual-debt-phone").value.trim();
  const amount = Math.max(0, Number(document.getElementById("manual-debt-amount").value) || 0);
  const note = document.getElementById("manual-debt-note").value.trim();
  const newManualDebtId = "DBT-" + Date.now().toString().slice(-6) + "-" + Math.random().toString(36).slice(2, 4).toUpperCase();
  markRecordDirty("debts", newManualDebtId);

  if (!name || amount <= 0) return;

  await db.debts.add({
    id: "DBT-" + Date.now().toString().slice(-6),
    transactionId: "MANUAL-" + Date.now().toString().slice(-4),
    customerName: name,
    customerPhone: phone,
    note: note,
    totalAmount: amount,
    paidAmount: 0,
    remainingAmount: amount,
    status: "unpaid",
    cashierId: state.currentUser.id,
    cashierName: state.currentUser.name,
    createdAt: new Date().toISOString(),
    paymentHistory: []
  });

  await refreshStateFromDB();
  scheduleCloudSync();
  closeManualDebtModal();
  renderDebtsView();
  showToast(`Kasbon atas nama ${name} berhasil ditambahkan!`, "success");
}

function sendDebtReminderWhatsApp(debt) {
  const storeName = state.receiptConfig.storeName || "Toko Kami";
  const msg =
    `Halo ${debt.customerName},\n` +
    `Berikut rincian catatan kasbon Anda di *${storeName}*:\n` +
    `• No. Nota: ${debt.transactionId || debt.id}\n` +
    `• Total Tagihan: ${formatRupiah(debt.totalAmount)}\n` +
    `• Sudah Dibayar: ${formatRupiah(debt.paidAmount)}\n` +
    `• *Sisa Tagihan: ${formatRupiah(debt.remainingAmount)}*\n\n` +
    `Terima kasih.`;

  const encoded = encodeURIComponent(msg);
  let targetPhone = "";
  if (debt.customerPhone) {
    const digits = debt.customerPhone.replace(/\D/g, "");
    if (digits.startsWith("0")) targetPhone = "62" + digits.slice(1);
    else if (digits.startsWith("62")) targetPhone = digits;
  }

  const url = targetPhone
    ? `https://wa.me/${targetPhone}?text=${encoded}`
    : `https://api.whatsapp.com/send?text=${encoded}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

// ============================================================================
// 6. PENGATURAN STRUK FLEKSIBEL, MONOCHROME LOGO, ESC/POS BLUETOOTH & WHATSAPP
// ============================================================================

// Pergantian Sub-Menu di Halaman Pengaturan Admin
function switchSettingsSubtab(subtab) {
  const isReceipt = subtab === "receipt";
  const isUsers = subtab === "users";
  const isCloud = subtab === "cloud";

  document.getElementById("subview-receipt").classList.toggle("hidden", !isReceipt);
  document.getElementById("subview-users").classList.toggle("hidden", !isUsers);
  document.getElementById("subview-cloud").classList.toggle("hidden", !isCloud);

  const activeCls = "flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-sky-600 text-white text-xs md:text-sm font-extrabold shadow-xs transition";
  const inactiveCls = "flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs md:text-sm font-extrabold transition";

  document.getElementById("btn-subtab-receipt").className = isReceipt ? activeCls : inactiveCls;
  document.getElementById("btn-subtab-users").className = isUsers ? activeCls : inactiveCls;
  document.getElementById("btn-subtab-cloud").className = isCloud ? activeCls : inactiveCls;

  if (isCloud) {
    renderCloudSettingsTab();
  }
}

// Konversi Gambar Logo ke Hitam-Putih Murni (Monochrome Floyd-Steinberg Dithering)
function processLogoImageToMonochrome(file, paperSize = "58") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Format gambar tidak valid."));
      img.onload = () => {
        // Lebar kelipatan 8 piksel agar optimal untuk ESC/POS raster (GS v 0)
        const targetMaxWidth = paperSize === "80" ? 256 : 192;
        const maxHeight = 144;

        let width = img.width;
        let height = img.height;

        if (width > targetMaxWidth) {
          height = Math.round((height * targetMaxWidth) / width);
          width = targetMaxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        // Pastikan lebar kelipatan 8 piksel
        width = Math.max(8, Math.floor(width / 8) * 8);
        height = Math.max(8, height);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        // Isi latar putih agar logo PNG transparan tidak berubah hitam
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const gray = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        // Floyd-Steinberg Error Diffusion Dithering -> Hitam (0) / Putih (255) Murni
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const oldPixel = gray[idx];
            const newPixel = oldPixel < 140 ? 0 : 255;
            gray[idx] = newPixel;
            const quantError = oldPixel - newPixel;

            if (x + 1 < width) gray[idx + 1] += (quantError * 7) / 16;
            if (y + 1 < height) {
              if (x > 0) gray[idx + width - 1] += (quantError * 3) / 16;
              gray[idx + width] += (quantError * 5) / 16;
              if (x + 1 < width) gray[idx + width + 1] += (quantError * 1) / 16;
            }
          }
        }

        for (let i = 0; i < width * height; i++) {
          const val = gray[i] === 0 ? 0 : 255;
          data[i * 4] = val;
          data[i * 4 + 1] = val;
          data[i * 4 + 2] = val;
          data[i * 4 + 3] = 255;
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateLogoSettingsUI(dataUrl) {
  const imgEl = document.getElementById("set-logo-preview-img");
  const placeholderEl = document.getElementById("set-logo-placeholder");
  const removeBtn = document.getElementById("btn-remove-logo");

  if (dataUrl) {
    imgEl.src = dataUrl;
    imgEl.classList.remove("hidden");
    placeholderEl.classList.add("hidden");
    removeBtn.classList.remove("hidden");
  } else {
    imgEl.src = "";
    imgEl.classList.add("hidden");
    placeholderEl.classList.remove("hidden");
    removeBtn.classList.add("hidden");
  }
}

function renderSettingsView() {
  if (state.currentUser.role !== "admin") return;

  // Render daftar akun kasir & admin
  const accList = document.getElementById("settings-account-list");
  accList.innerHTML = "";

  state.users.forEach((user) => {
    const isAdmin = user.role === "admin";
    const isActive = user.status === "active";
    const isSelf = user.id === state.currentUser.id;

    const row = document.createElement("div");
    row.className = `p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
      isActive ? "bg-white border-slate-200" : "bg-slate-100 border-slate-300 opacity-80"
    }`;

    row.innerHTML = `
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-extrabold text-sm text-slate-900">${escapeHtml(user.name)}</span>
          <span class="text-xs font-mono text-slate-500">@${escapeHtml(user.username || user.id)}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
            isAdmin ? "bg-indigo-100 text-indigo-800" : "bg-sky-100 text-sky-800"
          }">${user.role}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
            isActive ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"
          }">${isActive ? "Aktif" : "Nonaktif"}</span>
        </div>
        <p class="text-xs text-slate-500 mt-1">PIN Login: <strong class="tracking-widest text-slate-800">${escapeHtml(user.pin)}</strong></p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button type="button" data-action="edit" class="h-9 px-3 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-extrabold">
          Edit PIN / Data
        </button>
        ${
          isSelf
            ? `<span class="text-[11px] font-bold text-slate-400 px-2">Akun Anda</span>`
            : `<button type="button" data-action="toggle-status" class="h-9 px-3 rounded-xl text-xs font-extrabold ${
                isActive
                  ? "bg-rose-100 hover:bg-rose-200 text-rose-700"
                  : "bg-emerald-100 hover:bg-emerald-200 text-emerald-800"
              }">
                ${isActive ? "Nonaktifkan" : "Aktifkan"}
              </button>`
        }
      </div>
    `;

    row.querySelector('[data-action="edit"]').addEventListener("click", () => openEditAccountModal(user));

    const toggleBtn = row.querySelector('[data-action="toggle-status"]');
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => toggleAccountStatus(user));
    }

    accList.appendChild(row);
  });

  // Isi seluruh form pengaturan desain & struktur struk
  const cfg = state.receiptConfig;
  tempLogoDataUrl = cfg.logoDataUrl || "";
  updateLogoSettingsUI(tempLogoDataUrl);

  document.getElementById("set-paper-size").value = cfg.paperSize || "58";
  document.getElementById("set-store-name").value = cfg.storeName || "";
  document.getElementById("set-store-slogan").value = cfg.storeSlogan || "";
  document.getElementById("set-store-address").value = cfg.storeAddress || "";
  document.getElementById("set-store-phone").value = cfg.storePhone || "";
  document.getElementById("set-footer-line1").value =
    cfg.footerLine1 != null ? cfg.footerLine1 : cfg.footerText || "";
  document.getElementById("set-footer-line2").value = cfg.footerLine2 || "";

  document.getElementById("set-show-logo").checked = cfg.showLogo !== false;
  document.getElementById("set-show-address-phone").checked = cfg.showAddressPhone !== false;
  document.getElementById("set-show-cashier").checked = cfg.showCashier !== false;
  document.getElementById("set-show-receipt-datetime").checked =
    cfg.showReceiptNoDate != null ? cfg.showReceiptNoDate : cfg.showDate !== false;
  document.getElementById("set-show-customer").checked = cfg.showCustomer !== false;
  document.getElementById("set-show-item-discount").checked = cfg.showItemDiscount !== false;
  document.getElementById("set-show-total-savings").checked = cfg.showTotalSavings !== false;
  document.getElementById("set-show-payment-details").checked = cfg.showPaymentDetails !== false;
  document.getElementById("set-show-footer").checked = cfg.showFooter !== false;

  updateReceiptLivePreview();
}

function getReceiptFormConfig() {
  return {
    storeName: document.getElementById("set-store-name").value.trim() || "MINIMARKET",
    storeSlogan: document.getElementById("set-store-slogan").value.trim(),
    storeAddress: document.getElementById("set-store-address").value.trim(),
    storePhone: document.getElementById("set-store-phone").value.trim(),
    footerLine1: document.getElementById("set-footer-line1").value.trim(),
    footerLine2: document.getElementById("set-footer-line2").value.trim(),
    paperSize: document.getElementById("set-paper-size").value || "58",
    logoDataUrl: tempLogoDataUrl || "",
    showLogo: document.getElementById("set-show-logo").checked,
    showAddressPhone: document.getElementById("set-show-address-phone").checked,
    showCashier: document.getElementById("set-show-cashier").checked,
    showReceiptNoDate: document.getElementById("set-show-receipt-datetime").checked,
    showCustomer: document.getElementById("set-show-customer").checked,
    showItemDiscount: document.getElementById("set-show-item-discount").checked,
    showTotalSavings: document.getElementById("set-show-total-savings").checked,
    showPaymentDetails: document.getElementById("set-show-payment-details").checked,
    showFooter: document.getElementById("set-show-footer").checked
  };
}

async function handleSaveReceiptSettings(e) {
  e.preventDefault();
  if (state.currentUser.role !== "admin") return;

  const updatedConfig = getReceiptFormConfig();
  await db.settings.put({ key: "receiptConfig", value: updatedConfig });
  await refreshStateFromDB();
  scheduleCloudSync();
  
  document.getElementById("header-store-name").textContent = state.receiptConfig.storeName;
  updateReceiptLivePreview();
  showToast("Desain & struktur struk berhasil disimpan!", "success");
  markRecordDirty("settings", "receiptConfig");
}

// ============================================================================
// PENYUSUN TEKS STRUK DINAMIS (58MM / 80MM + SAKELAR ON/OFF)
// ============================================================================
function centerTextLine(text, width) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  if (clean.length >= width) return clean;
  const pad = Math.floor((width - clean.length) / 2);
  return " ".repeat(pad) + clean;
}

function formatKeyValueLine(left, right, width) {
  const l = String(left || "");
  const r = String(right || "");
  const spaces = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(spaces) + r;
}

function buildReceiptText(tx, cfg = state.receiptConfig) {
  const cols = cfg.paperSize === "80" ? 48 : 32;
  const divider = "-".repeat(cols);
  const lines = [];

  // Header Nama Toko & Slogan
  lines.push(centerTextLine((cfg.storeName || "MINIMARKET").toUpperCase(), cols));
  if (cfg.storeSlogan) {
    lines.push(centerTextLine(cfg.storeSlogan, cols));
  }

  // Sakelar: Alamat & No. Telepon
  if (cfg.showAddressPhone !== false) {
    if (cfg.storeAddress) lines.push(centerTextLine(cfg.storeAddress, cols));
    if (cfg.storePhone) lines.push(centerTextLine("Telp/WA: " + cfg.storePhone, cols));
  }

  lines.push(divider);

  // Sakelar: Nomor Nota & Tanggal/Jam
  const showNoDate = cfg.showReceiptNoDate != null ? cfg.showReceiptNoDate : cfg.showDate !== false;
  if (showNoDate) {
    lines.push(`Nota  : ${tx.id}`);
    const dt = new Date(tx.timestamp).toLocaleString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    lines.push(`Waktu : ${dt}`);
  }

  // Sakelar: Nama Kasir Bertugas
  if (cfg.showCashier !== false) {
    lines.push(`Kasir : ${tx.cashierName}`);
  }

  // Sakelar: Nama Pelanggan (jika diisi / kasbon)
  if (cfg.showCustomer !== false && tx.customerName) {
    lines.push(`Plg   : ${tx.customerName}`);
  }

  if (showNoDate || cfg.showCashier !== false || (cfg.showCustomer !== false && tx.customerName)) {
    lines.push(divider);
  }

  // Daftar Barang Belanja
  let totalItemSavings = 0;
  tx.items.forEach((item) => {
    const gross = item.qty * item.price;
    const itemDisc = Number(item.itemDiscountAmount) || 0;
    const lineTotal = item.netSubtotal != null ? item.netSubtotal : gross - itemDisc;
    totalItemSavings += itemDisc;

    lines.push(item.name);
    lines.push(formatKeyValueLine(`  ${item.qty} x ${formatRupiah(item.price)}`, formatRupiah(lineTotal), cols));

    // Sakelar: Rincian Diskon per Item
    if (cfg.showItemDiscount !== false && itemDisc > 0) {
      lines.push(`  (Diskon Item: -${formatRupiah(itemDisc)})`);
    }
  });

  lines.push(divider);

  // Sakelar: Total Hemat / Total Diskon
  const cartDisc = Number(tx.cartDiscountAmount) || 0;
  const totalSavings = totalItemSavings + cartDisc;

  if (cfg.showTotalSavings !== false && totalSavings > 0) {
    if (cartDisc > 0) {
      lines.push(formatKeyValueLine("SUBTOTAL", formatRupiah(tx.subtotalAmount), cols));
      lines.push(formatKeyValueLine("DISKON BELANJA", "-" + formatRupiah(cartDisc), cols));
    }
    lines.push(formatKeyValueLine("TOTAL HEMAT", formatRupiah(totalSavings), cols));
  }

  lines.push(formatKeyValueLine("TOTAL TAGIHAN", formatRupiah(tx.totalAmount), cols));

  // Sakelar: Metode Pembayaran & Kembalian
  if (cfg.showPaymentDetails !== false) {
    const method = tx.paymentMethod || "cash";
    if (method === "cash") {
      lines.push(formatKeyValueLine("METODE BAYAR", "TUNAI", cols));
      lines.push(formatKeyValueLine("UANG TUNAI", formatRupiah(tx.cashReceived), cols));
      lines.push(formatKeyValueLine("KEMBALIAN", formatRupiah(tx.changeAmount), cols));
    } else if (method === "non-cash") {
      lines.push(formatKeyValueLine("METODE BAYAR", "QRIS / TRANSFER", cols));
      if (tx.paymentNote) lines.push(formatKeyValueLine("REF", tx.paymentNote, cols));
      lines.push(formatKeyValueLine("STATUS", "LUNAS", cols));
    } else if (method === "debt") {
      lines.push(formatKeyValueLine("METODE BAYAR", "KASBON / HUTANG", cols));
      lines.push(formatKeyValueLine("STATUS", "BELUM LUNAS", cols));
    }
  }

  // Sakelar: Pesan Footer Baris 1 & Baris 2
  if (cfg.showFooter !== false) {
    const f1 = cfg.footerLine1 != null ? cfg.footerLine1 : cfg.footerText || "";
    const f2 = cfg.footerLine2 || "";
    if (f1 || f2) {
      lines.push(divider);
      if (f1) lines.push(centerTextLine(f1, cols));
      if (f2) lines.push(centerTextLine(f2, cols));
    }
  }

  return lines.join("\n");
}

function updateReceiptLivePreview() {
  const previewCfg = getReceiptFormConfig();
  const is80mm = previewCfg.paperSize === "80";

  document.getElementById("preview-paper-badge").textContent = is80mm ? "Kertas 80mm" : "Kertas 58mm";
  document.getElementById("receipt-preview-paper").className = `${
    is80mm ? "w-[340px]" : "w-[260px]"
  } bg-white p-4 rounded-lg shadow-md border border-slate-300 text-slate-900 transition-all`;

  const logoWrap = document.getElementById("receipt-preview-logo-wrap");
  const logoImg = document.getElementById("receipt-preview-logo");
  if (previewCfg.showLogo && previewCfg.logoDataUrl) {
    logoImg.src = previewCfg.logoDataUrl;
    logoWrap.classList.remove("hidden");
  } else {
    logoWrap.classList.add("hidden");
  }

  // Contoh transaksi untuk pratinjau langsung
  const sampleTx = {
    id: "TRX-100293",
    timestamp: new Date().toISOString(),
    cashierName: state.currentUser ? state.currentUser.name : "Kasir 1",
    customerName: "Budi Santoso",
    items: [
      { name: "Indomie Goreng Original", qty: 2, price: 3500, itemDiscountAmount: 500, netSubtotal: 6500 },
      { name: "Beras Premium Ramos 5kg", qty: 1, price: 75000, itemDiscountAmount: 0, netSubtotal: 75000 }
    ],
    subtotalAmount: 81500,
    cartDiscountAmount: 1500,
    totalAmount: 80000,
    paymentMethod: "cash",
    cashReceived: 100000,
    changeAmount: 20000
  };

  document.getElementById("receipt-live-preview").textContent = buildReceiptText(sampleTx, previewCfg);
}

function openReceiptModal(tx) {
  activeReceiptTx = tx;
  const cfg = state.receiptConfig;
  const is80mm = cfg.paperSize === "80";

  const printableBox = document.getElementById("printable-receipt");
  printableBox.className = `w-full ${
    is80mm ? "max-w-[350px]" : "max-w-[280px]"
  } bg-white p-4 rounded-xl shadow-sm border border-slate-200 text-slate-900`;

  const logoWrap = document.getElementById("modal-receipt-logo-wrap");
  const logoImg = document.getElementById("modal-receipt-logo");
  if (cfg.showLogo !== false && cfg.logoDataUrl) {
    logoImg.src = cfg.logoDataUrl;
    logoWrap.classList.remove("hidden");
  } else {
    logoWrap.classList.add("hidden");
  }

  document.getElementById("printable-receipt-text").textContent = buildReceiptText(tx, cfg);
  document.getElementById("modal-receipt").classList.remove("hidden");
}

function closeReceiptModal() {
  document.getElementById("modal-receipt").classList.add("hidden");
}

// ============================================================================
// KONEKSI & CETAK PRINTER THERMAL BLUETOOTH (WEB BLUETOOTH API + ESC/POS)
// ============================================================================
function updateBluetoothStatusUI(connected, deviceName = "") {
  const badge = document.getElementById("bt-printer-status-badge");
  if (!badge) return;
  if (connected) {
    badge.textContent = `Printer BT: ${deviceName || "Terhubung"}`;
    badge.className = "px-3 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800";
  } else {
    badge.textContent = "Printer BT: Belum Terhubung";
    badge.className = "px-3 py-1 rounded-full text-[11px] font-extrabold bg-slate-100 text-slate-600";
  }
}

async function ensureBluetoothPrinterConnected() {
  if (!navigator.bluetooth) {
    throw new Error("Browser ini tidak mendukung Web Bluetooth. Gunakan Google Chrome di Android/PC.");
  }

  if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected && bluetoothCharacteristic) {
    return bluetoothCharacteristic;
  }

  // UUID layanan umum berbagai merek printer thermal Bluetooth (58mm & 80mm)
  const commonServices = [
    "000018f0-0000-1000-8000-00805f9b34fb",
    "0000ff00-0000-1000-8000-00805f9b34fb",
    "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    "0000fee7-0000-1000-8000-00805f9b34fb"
  ];

  bluetoothDevice = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: commonServices
  });

  bluetoothDevice.addEventListener("gattserverdisconnected", () => {
    bluetoothCharacteristic = null;
    updateBluetoothStatusUI(false);
  });

  const server = await bluetoothDevice.gatt.connect();
  const services = await server.getPrimaryServices();

  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const char of characteristics) {
      if (char.properties.write || char.properties.writeWithoutResponse) {
        bluetoothCharacteristic = char;
        updateBluetoothStatusUI(true, bluetoothDevice.name);
        return char;
      }
    }
  }

  throw new Error("Karakteristik cetak tidak ditemukan pada perangkat Bluetooth ini.");
}

// Konversi DataURL Logo Monochrome menjadi Perintah Raster ESC/POS (GS v 0)
function dataUrlToEscPosRasterBytes(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(new Uint8Array(0));
      return;
    }
    const img = new Image();
    img.onerror = () => resolve(new Uint8Array(0));
    img.onload = () => {
      const width = Math.floor(img.width / 8) * 8;
      const height = img.height;
      if (width <= 0 || height <= 0) {
        resolve(new Uint8Array(0));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const pixels = ctx.getImageData(0, 0, width, height).data;
      const widthBytes = width / 8;
      const bitmapData = new Uint8Array(widthBytes * height);

      for (let y = 0; y < height; y++) {
        for (let xByte = 0; xByte < widthBytes; xByte++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = xByte * 8 + bit;
            const idx = (y * width + x) * 4;
            const lum = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
            if (lum < 128) {
              byteVal |= 1 << (7 - bit);
            }
          }
          bitmapData[y * widthBytes + xByte] = byteVal;
        }
      }

      const xL = widthBytes & 0xff;
      const xH = (widthBytes >> 8) & 0xff;
      const yL = height & 0xff;
      const yH = (height >> 8) & 0xff;

      // ESC a 1 (Rata Tengah) + GS v 0 0 xL xH yL yH [data] + ESC a 0 (Rata Kiri)
      const header = new Uint8Array([0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
      const footer = new Uint8Array([0x0a, 0x1b, 0x61, 0x00]);

      const full = new Uint8Array(header.length + bitmapData.length + footer.length);
      full.set(header, 0);
      full.set(bitmapData, header.length);
      full.set(footer, header.length + bitmapData.length);
      resolve(full);
    };
    img.src = dataUrl;
  });
}

async function sendBytesInChunks(characteristic, bytes) {
  const chunkSize = 100;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function printReceiptViaBluetooth(tx, customConfig = null) {
  if (!tx) return;
  const cfg = customConfig || state.receiptConfig;

  try {
    showToast("Menghubungkan ke Printer Bluetooth...", "info");
    const characteristic = await ensureBluetoothPrinterConnected();

    // 1. Inisialisasi Printer ESC/POS (ESC @)
    const initCmd = new Uint8Array([0x1b, 0x40]);

    // 2. Raster Logo Toko jika sakelar Logo aktif
    let logoBytes = new Uint8Array(0);
    if (cfg.showLogo !== false && cfg.logoDataUrl) {
      logoBytes = await dataUrlToEscPosRasterBytes(cfg.logoDataUrl);
    }

    // 3. Teks Struk sesuai struktur & sakelar Admin
    const receiptText = buildReceiptText(tx, cfg) + "\n\n\n\n";
    // Bersihkan karakter non-ASCII agar printer thermal standar tidak mencetak simbol aneh
    const asciiSafeText = receiptText.replace(/[^\x0A\x0D\x20-\x7E]/g, " ");
    const textBytes = new TextEncoder().encode(asciiSafeText);

    // Gabungkan seluruh perintah ESC/POS
    const packet = new Uint8Array(initCmd.length + logoBytes.length + textBytes.length);
    packet.set(initCmd, 0);
    packet.set(logoBytes, initCmd.length);
    packet.set(textBytes, initCmd.length + logoBytes.length);

    await sendBytesInChunks(characteristic, packet);
    showToast("Struk berhasil dicetak ke Printer Bluetooth!", "success");
  } catch (err) {
    console.error("Bluetooth Print Error:", err);
    showToast(err.message || "Gagal mencetak ke Printer Bluetooth.", "error");
  }
}

// ============================================================================
// KIRIM STRUK KE WHATSAPP (MENGIKUTI SAKELAR STRUK ADMIN)
// ============================================================================
function sendReceiptToWhatsApp(tx) {
  if (!tx) return;
  const receiptBody = buildReceiptText(tx, state.receiptConfig);
  const formattedMessage = "```\n" + receiptBody + "\n```";
  const encodedText = encodeURIComponent(formattedMessage);

  // Jika transaksi kasbon memiliki nomor HP pelanggan, langsung arahkan ke chat pelanggan tersebut
  let targetPhone = "";
  if (tx.customerPhone) {
    const digits = tx.customerPhone.replace(/\D/g, "");
    if (digits.startsWith("0")) {
      targetPhone = "62" + digits.slice(1);
    } else if (digits.startsWith("62")) {
      targetPhone = digits;
    }
  }

  const waUrl = targetPhone
    ? `https://wa.me/${targetPhone}?text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;

  window.open(waUrl, "_blank", "noopener,noreferrer");
}

// ============================================================================
// MANAJEMEN AKUN KASIR (TAMBAH, EDIT PIN, AKTIF/NONAKTIF)
// ============================================================================
async function handleAddAccount(e) {
  e.preventDefault();
  if (state.currentUser.role !== "admin") return;

  const name = document.getElementById("new-acc-name").value.trim();
  const username = document.getElementById("new-acc-username").value.trim().toLowerCase().replace(/\s+/g, "");
  const pin = document.getElementById("new-acc-pin").value.trim();
  const role = document.getElementById("new-acc-role").value;
  const status = document.getElementById("new-acc-status").value;
  const newUserId = "usr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
  markRecordDirty("users", newUserId);

  if (!/^\d{4,6}$/.test(pin)) {
    showToast("PIN harus terdiri dari 4 sampai 6 angka!", "error");
    return;
  }

  const duplicateUsername = state.users.some((u) => (u.username || "").toLowerCase() === username);
  if (duplicateUsername) {
    showToast(`Username "@${username}" sudah digunakan!`, "error");
    return;
  }

  await db.users.add({
    id: "usr_" + Date.now(),
    name,
    username,
    pin,
    role,
    status
  });

  await refreshStateFromDB();
  scheduleCloudSync();
  document.getElementById("form-add-account").reset();
  renderSettingsView();
  showToast(`Akun "${name}" berhasil ditambahkan!`, "success");
}

function openEditAccountModal(user) {
  if (state.currentUser.role !== "admin") return;

  const isSelf = user.id === state.currentUser.id;
  document.getElementById("edit-acc-id").value = user.id;
  document.getElementById("edit-acc-name").value = user.name;
  document.getElementById("edit-acc-username").value = user.username || "";
  document.getElementById("edit-acc-pin").value = user.pin;
  document.getElementById("edit-acc-role").value = user.role;
  document.getElementById("edit-acc-status").value = user.status;

  document.getElementById("edit-acc-role").disabled = isSelf;
  document.getElementById("edit-acc-status").disabled = isSelf;

  document.getElementById("modal-edit-account").classList.remove("hidden");
}

function closeEditAccountModal() {
  document.getElementById("modal-edit-account").classList.add("hidden");
}

async function handleSaveEditAccount(e) {
  e.preventDefault();
  if (state.currentUser.role !== "admin") return;

  const id = document.getElementById("edit-acc-id").value;
  const name = document.getElementById("edit-acc-name").value.trim();
  const username = document.getElementById("edit-acc-username").value.trim().toLowerCase().replace(/\s+/g, "");
  const pin = document.getElementById("edit-acc-pin").value.trim();
  const role = document.getElementById("edit-acc-role").value;
  const status = document.getElementById("edit-acc-status").value;

  if (!/^\d{4,6}$/.test(pin)) {
    showToast("PIN harus 4 sampai 6 digit angka!", "error");
    return;
  }

  const duplicate = state.users.some((u) => (u.username || "").toLowerCase() === username && u.id !== id);
  if (duplicate) {
    showToast(`Username "@${username}" sudah dipakai akun lain!`, "error");
    return;
  }

  await db.users.update(id, { name, username, pin, role, status });
  await refreshStateFromDB();
  scheduleCloudSync();

  if (id === state.currentUser.id) {
    state.currentUser = state.users.find((u) => u.id === id);
    applyRolePermissions();
  }

  closeEditAccountModal();
  renderSettingsView();
  showToast("Perubahan akun & PIN berhasil disimpan!", "success");
  markRecordDirty("users", id);
}

async function toggleAccountStatus(user) {
  if (state.currentUser.role !== "admin" || user.id === state.currentUser.id) return;

  const nextStatus = user.status === "active" ? "inactive" : "active";
  const actionLabel = nextStatus === "inactive" ? "menonaktifkan" : "mengaktifkan kembali";

  if (confirm(`Yakin ingin ${actionLabel} akun "${user.name}"? Riwayat transaksi lamanya tetap aman.`)) {
    await db.users.update(user.id, { status: nextStatus });
    await refreshStateFromDB();
    scheduleCloudSync();
    renderSettingsView();
    showToast(
      nextStatus === "inactive"
        ? `Akun "${user.name}" dinonaktifkan.`
        : `Akun "${user.name}" diaktifkan kembali.`,
      "success"
    );
    markRecordDirty("users", user.id);
  }
}

// ============================================================================
// 6B. MESIN SINKRONISASI HYBRID 2 ARAH (SMART MERGE ANTI-OVERWRITE)
// ============================================================================
const CLOUD_CONFIG_STORAGE_KEY = "pos_mm_cloud_config_v1";
const CLOUD_DELETED_PRODUCTS_KEY = "pos_mm_deleted_products_v1";
const CLOUD_DIRTY_QUEUE_KEY = "pos_mm_dirty_queue_v2";

let cloudConfig = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  autoSync: true,
  lastSyncAt: ""
};

let isSyncingNow = false;
let autoSyncDebounceTimer = null;
let periodicSyncInterval = null;

function getEmptyDirtyQueue() {
  return {
    users: [],
    products: [],
    transactions: [],
    debts: [],
    settings: []
  };
}

function loadDirtyQueue() {
  try {
    const raw = localStorage.getItem(CLOUD_DIRTY_QUEUE_KEY);
    if (!raw) return getEmptyDirtyQueue();
    return { ...getEmptyDirtyQueue(), ...JSON.parse(raw) };
  } catch (e) {
    return getEmptyDirtyQueue();
  }
}

function saveDirtyQueue(queue) {
  localStorage.setItem(CLOUD_DIRTY_QUEUE_KEY, JSON.stringify(queue));
}

// Tandai 1 baris data yang baru dibuat/diubah di perangkat ini agar dikirim ke Cloud
function markRecordDirty(tableName, recordId) {
  if (!recordId) return;
  const queue = loadDirtyQueue();
  if (!Array.isArray(queue[tableName])) queue[tableName] = [];
  if (!queue[tableName].includes(recordId)) {
    queue[tableName].push(recordId);
    saveDirtyQueue(queue);
  }
}

function removeRecordFromDirty(tableName, recordId) {
  const queue = loadDirtyQueue();
  if (!Array.isArray(queue[tableName])) return;
  queue[tableName] = queue[tableName].filter((id) => id !== recordId);
  saveDirtyQueue(queue);
}

// Tandai semua data lokal saat pertama kali menghubungkan Cloud yang masih kosong
async function markAllLocalRecordsDirtyOnce() {
  const queue = loadDirtyQueue();
  const [users, products, transactions, debts, settings] = await Promise.all([
    db.users.toArray(),
    db.products.toArray(),
    db.transactions.toArray(),
    db.debts.toArray(),
    db.settings.toArray()
  ]);

  users.forEach((u) => { if (!queue.users.includes(u.id)) queue.users.push(u.id); });
  products.forEach((p) => { if (!queue.products.includes(p.id)) queue.products.push(p.id); });
  transactions.forEach((t) => { if (!queue.transactions.includes(t.id)) queue.transactions.push(t.id); });
  debts.forEach((d) => { if (!queue.debts.includes(d.id)) queue.debts.push(d.id); });
  settings.forEach((s) => { if (!queue.settings.includes(s.key)) queue.settings.push(s.key); });

  saveDirtyQueue(queue);
}

function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_STORAGE_KEY);
    if (raw) {
      cloudConfig = { ...cloudConfig, ...JSON.parse(raw) };
    }
  } catch (e) {
    // Gunakan default
  }
  updateCloudStatusUI();
}

function saveCloudConfigToStorage() {
  localStorage.setItem(CLOUD_CONFIG_STORAGE_KEY, JSON.stringify(cloudConfig));
  updateCloudStatusUI();
}

function isCloudConfigured() {
  return Boolean(
    cloudConfig.supabaseUrl &&
    cloudConfig.supabaseUrl.startsWith("http") &&
    cloudConfig.supabaseAnonKey &&
    cloudConfig.supabaseAnonKey.length > 10
  );
}

function updateCloudStatusUI() {
  const badgeEl = document.getElementById("cloud-sync-status-badge");
  const netEl = document.getElementById("cloud-network-status");
  const timeEl = document.getElementById("cloud-last-sync-time");

  if (netEl) {
    if (navigator.onLine) {
      netEl.textContent = "Online (Terhubung Internet)";
      netEl.className = "font-extrabold text-emerald-700 mt-0.5";
    } else {
      netEl.textContent = "Offline (Mode Lokal Aktif)";
      netEl.className = "font-extrabold text-amber-700 mt-0.5";
    }
  }

  if (timeEl) {
    timeEl.textContent = cloudConfig.lastSyncAt
      ? new Date(cloudConfig.lastSyncAt).toLocaleString("id-ID")
      : "Belum pernah sinkronisasi";
  }

  if (!badgeEl) return;

  if (!isCloudConfigured()) {
    badgeEl.textContent = "Cloud: Belum Diatur";
    badgeEl.className = "px-3 py-1 rounded-full text-[11px] font-extrabold bg-slate-100 text-slate-600";
  } else if (isSyncingNow) {
    badgeEl.textContent = "Cloud: Menyinkronkan...";
    badgeEl.className = "px-3 py-1 rounded-full text-[11px] font-extrabold bg-sky-100 text-sky-800";
  } else if (!navigator.onLine) {
    badgeEl.textContent = "Cloud: Menunggu Internet";
    badgeEl.className = "px-3 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800";
  } else {
    badgeEl.textContent = "Cloud: Terhubung (2-Arah)";
    badgeEl.className = "px-3 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800";
  }
}

function trackDeletedProductId(productId) {
  removeRecordFromDirty("products", productId);
  try {
    const raw = localStorage.getItem(CLOUD_DELETED_PRODUCTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!list.includes(productId)) {
      list.push(productId);
      localStorage.setItem(CLOUD_DELETED_PRODUCTS_KEY, JSON.stringify(list));
    }
  } catch (e) {
    // Abaikan
  }
}

function getSupabaseHeaders(preferUpsert = false) {
  const headers = {
    apikey: cloudConfig.supabaseAnonKey,
    Authorization: `Bearer ${cloudConfig.supabaseAnonKey}`,
    "Content-Type": "application/json"
  };
  if (preferUpsert) {
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal";
  }
  return headers;
}

function getSupabaseBaseUrl() {
  return cloudConfig.supabaseUrl.trim().replace(/\/+$/, "");
}

function normalizeRowsForSupabase(tableName, rows) {
  if (tableName === "users") {
    return rows.map((u) => ({
      id: u.id,
      name: u.name || "",
      username: u.username || "",
      pin: u.pin || "1234",
      role: u.role || "kasir",
      status: u.status || "active"
    }));
  }
  if (tableName === "products") {
    return rows.map((p) => ({
      id: p.id,
      barcode: p.barcode || "",
      name: p.name || "",
      category: p.category || "Lainnya",
      cost: Number(p.cost) || 0,
      price: Number(p.price) || 0,
      stock: Number(p.stock) || 0,
      minStock: p.minStock != null ? Number(p.minStock) : 5
    }));
  }
  if (tableName === "transactions") {
    return rows.map((t) => ({
      id: t.id,
      timestamp: t.timestamp,
      cashierId: t.cashierId || "",
      cashierName: t.cashierName || "",
      items: Array.isArray(t.items) ? t.items : [],
      subtotalAmount: Number(t.subtotalAmount) || 0,
      cartDiscountAmount: Number(t.cartDiscountAmount) || 0,
      totalAmount: Number(t.totalAmount) || 0,
      totalCost: Number(t.totalCost) || 0,
      netProfit: Number(t.netProfit) || 0,
      paymentMethod: t.paymentMethod || "cash",
      paymentNote: t.paymentNote || "",
      customerName: t.customerName || "",
      customerPhone: t.customerPhone || "",
      cashReceived: Number(t.cashReceived) || 0,
      changeAmount: Number(t.changeAmount) || 0,
      status: t.status || "completed",
      voidedAt: t.voidedAt || null,
      voidedBy: t.voidedBy || null,
      voidReason: t.voidReason || null
    }));
  }
  if (tableName === "debts") {
    return rows.map((d) => ({
      id: d.id,
      transactionId: d.transactionId || "",
      customerName: d.customerName || "",
      customerPhone: d.customerPhone || "",
      note: d.note || "",
      totalAmount: Number(d.totalAmount) || 0,
      paidAmount: Number(d.paidAmount) || 0,
      remainingAmount: Number(d.remainingAmount) || 0,
      status: d.status || "unpaid",
      cashierId: d.cashierId || "",
      cashierName: d.cashierName || "",
      createdAt: d.createdAt || new Date().toISOString(),
      paymentHistory: Array.isArray(d.paymentHistory) ? d.paymentHistory : []
    }));
  }
  if (tableName === "settings") {
    return rows.map((s) => ({
      key: s.key,
      value: s.value || {}
    }));
  }
  return rows;
}

async function upsertTableToSupabase(tableName, rows) {
  if (!rows || rows.length === 0) return;
  const baseUrl = getSupabaseBaseUrl();
  const normalized = normalizeRowsForSupabase(tableName, rows);

  const res = await fetch(`${baseUrl}/rest/v1/${tableName}`, {
    method: "POST",
    headers: getSupabaseHeaders(true),
    body: JSON.stringify(normalized)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal sinkron tabel ${tableName}: ${res.status} ${errText}`);
  }
}

async function fetchTableFromSupabase(tableName) {
  const baseUrl = getSupabaseBaseUrl();
  const res = await fetch(`${baseUrl}/rest/v1/${tableName}?select=*`, {
    headers: getSupabaseHeaders(false)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal membaca tabel ${tableName}: ${res.status} ${errText}`);
  }
  return res.json();
}

async function flushDeletedProductsToSupabase() {
  const raw = localStorage.getItem(CLOUD_DELETED_PRODUCTS_KEY);
  const deletedIds = raw ? JSON.parse(raw) : [];
  if (deletedIds.length === 0) return;

  const baseUrl = getSupabaseBaseUrl();
  const remaining = [];

  for (const delId of deletedIds) {
    try {
      const res = await fetch(`${baseUrl}/rest/v1/products?id=eq.${encodeURIComponent(delId)}`, {
        method: "DELETE",
        headers: getSupabaseHeaders(false)
      });
      if (!res.ok) remaining.push(delId);
    } catch (e) {
      remaining.push(delId);
    }
  }

  localStorage.setItem(CLOUD_DELETED_PRODUCTS_KEY, JSON.stringify(remaining));
}

// Gabungkan data Cloud ke IndexedDB tanpa menimpa perubahan lokal yang belum terkirim
async function pullAndMergeFromCloud() {
  const [cloudUsers, cloudProducts, cloudTransactions, cloudDebts, cloudSettings] = await Promise.all([
    fetchTableFromSupabase("users"),
    fetchTableFromSupabase("products"),
    fetchTableFromSupabase("transactions"),
    fetchTableFromSupabase("debts"),
    fetchTableFromSupabase("settings")
  ]);

  const dirtyNow = loadDirtyQueue();
  const deletedProductIds = JSON.parse(localStorage.getItem(CLOUD_DELETED_PRODUCTS_KEY) || "[]");

  await db.transaction("rw", db.users, db.products, db.transactions, db.debts, db.settings, async () => {
    // 1. Gabung Akun Kasir (Users)
    for (const cu of cloudUsers) {
      if (!dirtyNow.users.includes(cu.id)) {
        await db.users.put(cu);
      }
    }

    // 2. Gabung Produk & Stok (Hanya timpa jika produk tidak sedang diubah lokal)
    for (const cp of cloudProducts) {
      if (!deletedProductIds.includes(cp.id) && !dirtyNow.products.includes(cp.id)) {
        await db.products.put(cp);
      }
    }

    // 3. Gabung Transaksi (Append-Only + Pertahankan status Retur/Void)
    for (const ct of cloudTransactions) {
      const localTx = await db.transactions.get(ct.id);
      if (!localTx) {
        await db.transactions.put(ct);
      } else if (ct.status === "voided" && localTx.status !== "voided") {
        await db.transactions.put(ct);
      }
    }

    // 4. Gabung Kasbon & Cicilan (Gabung riwayat cicilan & hitung ulang sisa hutang)
    for (const cd of cloudDebts) {
      const localDebt = await db.debts.get(cd.id);
      if (!localDebt) {
        await db.debts.put(cd);
      } else if (!dirtyNow.debts.includes(cd.id)) {
        const localHist = Array.isArray(localDebt.paymentHistory) ? localDebt.paymentHistory : [];
        const cloudHist = Array.isArray(cd.paymentHistory) ? cd.paymentHistory : [];
        const mergedHistMap = new Map();

        [...localHist, ...cloudHist].forEach((entry) => {
          const key = `${entry.date}_${entry.amount}`;
          mergedHistMap.set(key, entry);
        });

        const mergedHistory = Array.from(mergedHistMap.values());
        const histPaidSum = mergedHistory.reduce((s, h) => s + (Number(h.amount) || 0), 0);
        const totalAmt = Number(cd.totalAmount || localDebt.totalAmount) || 0;
        const bestPaid = Math.min(
          totalAmt,
          Math.max(Number(localDebt.paidAmount) || 0, Number(cd.paidAmount) || 0, histPaidSum)
        );
        const remaining = Math.max(0, totalAmt - bestPaid);
        const isVoided = localDebt.status === "voided" || cd.status === "voided";
        const mergedStatus = isVoided
          ? "voided"
          : remaining === 0
          ? "paid"
          : bestPaid > 0
          ? "partial"
          : "unpaid";

        await db.debts.put({
          ...cd,
          paidAmount: bestPaid,
          remainingAmount: isVoided ? 0 : remaining,
          status: mergedStatus,
          paymentHistory: mergedHistory
        });
      }
    }

    // 5. Gabung Pengaturan Struk
    for (const cs of cloudSettings) {
      if (!dirtyNow.settings.includes(cs.key)) {
        await db.settings.put(cs);
      }
    }
  });

  await refreshStateFromDB();
  refreshActiveScreenAfterSync();
}

// Segarkan tampilan layar yang sedang dibuka kasir/admin setelah menerima data baru dari Cloud
function refreshActiveScreenAfterSync() {
  if (!state.currentUser) {
    renderLoginScreen();
    return;
  }
  applyRolePermissions();
  if (state.activeTab === "kasir") {
    populateKasirCategories();
    renderKasirProducts();
  } else if (state.activeTab === "produk") {
    renderManageProducts();
  } else if (state.activeTab === "riwayat") {
    renderHistoryView();
  } else if (state.activeTab === "kasbon") {
    renderDebtsView();
  }
}

// Sinkronisasi Penuh 2 Arah: (1) Kirim Perubahan Lokal -> (2) Tarik & Gabung Data Cloud
async function syncAllToCloud(silent = true) {
  if (!isCloudConfigured() || !navigator.onLine || isSyncingNow) {
    updateCloudStatusUI();
    return false;
  }

  isSyncingNow = true;
  updateCloudStatusUI();

  try {
    // Jika belum pernah sinkronisasi sama sekali, tandai data lokal awal agar ikut terunggah
    if (!cloudConfig.lastSyncAt) {
      await markAllLocalRecordsDirtyOnce();
    }

    // TAHAP 1 (PUSH): Kirim hanya data yang berubah/baru di perangkat ini
    await flushDeletedProductsToSupabase();
    const queue = loadDirtyQueue();

    if (queue.users.length > 0) {
      const dirtyUsers = (await db.users.bulkGet(queue.users)).filter(Boolean);
      await upsertTableToSupabase("users", dirtyUsers);
      queue.users = [];
    }

    if (queue.products.length > 0) {
      const dirtyProducts = (await db.products.bulkGet(queue.products)).filter(Boolean);
      await upsertTableToSupabase("products", dirtyProducts);
      queue.products = [];
    }

    if (queue.transactions.length > 0) {
      const dirtyTx = (await db.transactions.bulkGet(queue.transactions)).filter(Boolean);
      await upsertTableToSupabase("transactions", dirtyTx);
      queue.transactions = [];
    }

    if (queue.debts.length > 0) {
      const dirtyDebts = (await db.debts.bulkGet(queue.debts)).filter(Boolean);
      await upsertTableToSupabase("debts", dirtyDebts);
      queue.debts = [];
    }

    if (queue.settings.length > 0) {
      const dirtySettings = (await db.settings.bulkGet(queue.settings)).filter(Boolean);
      await upsertTableToSupabase("settings", dirtySettings);
      queue.settings = [];
    }

    saveDirtyQueue(queue);

    // TAHAP 2 (PULL & MERGE): Unduh & gabungkan data terbaru dari perangkat lain
    await pullAndMergeFromCloud();

    cloudConfig.lastSyncAt = new Date().toISOString();
    saveCloudConfigToStorage();

    if (!silent) {
      showToast("Sinkronisasi 2-arah dengan Cloud berhasil!", "success");
    }
    return true;
  } catch (err) {
    console.error("Cloud Sync Error:", err);
    if (!silent) {
      showToast(err.message || "Gagal menyinkronkan ke Supabase.", "error");
    }
    return false;
  } finally {
    isSyncingNow = false;
    updateCloudStatusUI();
  }
}

function scheduleCloudSync() {
  if (!isCloudConfigured() || !cloudConfig.autoSync) return;
  clearTimeout(autoSyncDebounceTimer);
  autoSyncDebounceTimer = setTimeout(() => {
    syncAllToCloud(true);
  }, 1000);
}

// Pulihkan / Unduh seluruh data dari Supabase ke IndexedDB perangkat baru
async function restoreAllDataFromCloud() {
  if (!isCloudConfigured()) {
    showToast("Masukkan URL dan Anon Key Supabase terlebih dahulu!", "error");
    return;
  }
  if (!navigator.onLine) {
    showToast("Perangkat sedang offline. Hubungkan internet untuk memulihkan data.", "error");
    return;
  }

  if (
    !confirm(
      "Pulihkan & gabungkan seluruh data dari Cloud Supabase ke perangkat ini?"
    )
  ) {
    return;
  }

  isSyncingNow = true;
  updateCloudStatusUI();
  showToast("Mengunduh & menggabungkan data dari Cloud...", "info");

  try {
    await pullAndMergeFromCloud();
    cloudConfig.lastSyncAt = new Date().toISOString();
    saveCloudConfigToStorage();
    showToast("Seluruh data berhasil dipulihkan dari Cloud!", "success");
  } catch (err) {
    console.error("Restore Cloud Error:", err);
    showToast(err.message || "Gagal memulihkan data dari Cloud.", "error");
  } finally {
    isSyncingNow = false;
    updateCloudStatusUI();
  }
}

function renderCloudSettingsTab() {
  document.getElementById("cloud-supabase-url").value = cloudConfig.supabaseUrl || "";
  document.getElementById("cloud-supabase-key").value = cloudConfig.supabaseAnonKey || "";
  document.getElementById("cloud-auto-sync").checked = cloudConfig.autoSync !== false;
  updateCloudStatusUI();
}

// ============================================================================
// 7. INISIALISASI EVENT & STARTUP APLIKASI
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  await initDatabase();
  loadCloudConfig();
  loadHeldCarts();
  setupGlobalHardwareScanner();

  // Keypad PIN Login
  document.querySelectorAll(".pin-key").forEach((btn) => {
    btn.addEventListener("click", () => handlePinDigit(btn.dataset.pin));
  });
  document.getElementById("btn-pin-clear").addEventListener("click", () => {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    document.getElementById("login-error-msg").textContent = "";
    updatePinDisplay();
  });
  document.getElementById("btn-pin-submit").addEventListener("click", handlePinSubmit);

  // Dukungan keyboard fisik untuk PIN di layar login
  document.addEventListener("keydown", (e) => {
    if (document.getElementById("login-screen").classList.contains("hidden")) return;
    if (/^[0-9]$/.test(e.key)) {
      handlePinDigit(e.key);
    } else if (e.key === "Backspace") {
      state.pinBuffer = state.pinBuffer.slice(0, -1);
      updatePinDisplay();
    } else if (e.key === "Enter") {
      handlePinSubmit();
    }
  });

  // Logout / Ganti Shift
  document.getElementById("btn-logout").addEventListener("click", logoutUser);

  // Navigasi Tab
  document.querySelectorAll(".nav-btn, .mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Kontrol Split-Screen / Mobile Cart di Tab Kasir
  document.getElementById("btn-show-mobile-cart").addEventListener("click", showMobileCartPane);
  document.getElementById("btn-back-to-products").addEventListener("click", resetMobileKasirPane);
  document.getElementById("btn-clear-cart").addEventListener("click", () => {
    state.cart = [];
    document.getElementById("cart-discount-input").value = "0";
    document.getElementById("cash-received-input").value = "";
    renderKasirProducts();
    renderCart();
  });

  // Kamera Barcode Scanner (Kasir & Input Barang)
  document.getElementById("btn-open-camera-scanner").addEventListener("click", () => openCameraScannerModal("kasir"));
  document.getElementById("btn-scan-product-camera").addEventListener("click", () => openCameraScannerModal("product"));
  document.getElementById("btn-scan-modal-barcode").addEventListener("click", () => openCameraScannerModal("product"));
  document.getElementById("btn-close-camera-scanner").addEventListener("click", closeCameraScannerModal);
  document.getElementById("btn-done-camera-scanner").addEventListener("click", closeCameraScannerModal);

  // Tangkap tombol Enter dari alat scanner eksternal di dalam input Kode Barcode
  document.getElementById("prod-barcode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) {
        handleProductBarcodeInput(val);
      } else {
        document.getElementById("prod-name").focus();
      }
    }
  });

  // Tahan / Tunda Transaksi (Hold Cart)
  document.getElementById("btn-hold-cart").addEventListener("click", holdCurrentCart);
  document.getElementById("btn-open-held-carts").addEventListener("click", openHeldCartsModal);
  document.getElementById("btn-close-held-carts").addEventListener("click", closeHeldCartsModal);

  // Diskon Per Item & Diskon Total
  document.getElementById("btn-close-item-discount").addEventListener("click", closeItemDiscountModal);
  document.getElementById("form-item-discount").addEventListener("submit", saveItemDiscountForm);
  document.getElementById("btn-remove-item-discount").addEventListener("click", removeItemDiscount);
  document.getElementById("cart-discount-type").addEventListener("change", renderCart);
  document.getElementById("cart-discount-input").addEventListener("input", renderCart);

  // Pencarian Nama / Barcode
  const kasirSearchInput = document.getElementById("kasir-search-input");
  kasirSearchInput.addEventListener("input", renderKasirProducts);
  document.getElementById("kasir-category-filter").addEventListener("change", renderKasirProducts);

  // Metode Pembayaran (Tunai, Non-Tunai, Kasbon)
  document.querySelectorAll(".pay-method-btn").forEach((btn) => {
    btn.addEventListener("click", () => setPaymentMethod(btn.dataset.payMethod));
  });

  // Pembayaran Tunai, Uang Cepat & Input Kasbon
  document.getElementById("cash-received-input").addEventListener("input", () => updateCheckoutValidation());
  document.getElementById("debt-customer-name").addEventListener("input", () => updateCheckoutValidation());
  document.querySelectorAll(".quick-cash-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.cash;
      const input = document.getElementById("cash-received-input");
      input.value = val === "EXACT" ? getCartCalculation().grandTotal : val;
      updateCheckoutValidation();
    });
  });
  document.getElementById("btn-checkout").addEventListener("click", processCheckout);

  // Manajemen Produk & Stok (Admin)
  document.getElementById("manage-product-search").addEventListener("input", renderManageProducts);
  document.getElementById("manage-stock-filter").addEventListener("change", renderManageProducts);
  document.getElementById("btn-open-add-product").addEventListener("click", () => openProductModal(null));
  document.getElementById("btn-close-product-modal").addEventListener("click", closeProductModal);
  document.getElementById("btn-cancel-product-modal").addEventListener("click", closeProductModal);
  document.getElementById("form-product").addEventListener("submit", saveProductForm);

  // Ekspor & Impor CSV / Excel (Admin)
  document.getElementById("btn-export-csv").addEventListener("click", exportProductsToCSV);
  document.getElementById("btn-open-import-csv").addEventListener("click", openImportCsvModal);
  document.getElementById("btn-close-import-csv").addEventListener("click", closeImportCsvModal);
  document.getElementById("btn-cancel-import-csv").addEventListener("click", closeImportCsvModal);
  document.getElementById("btn-download-csv-template").addEventListener("click", downloadSampleCsvTemplate);
  document.getElementById("csv-file-input").addEventListener("change", handleCsvFileSelected);
  document.getElementById("btn-confirm-import-csv").addEventListener("click", confirmImportCsvData);

  // Laporan & Riwayat Transaksi (Filter Waktu, Kasir, Detail & Retur PIN Admin)
  document.getElementById("riwayat-cashier-filter").addEventListener("change", renderHistoryView);
  document.querySelectorAll(".period-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => setRiwayatPeriodFilter(btn.dataset.period));
  });
  document.getElementById("riwayat-date-start").addEventListener("change", renderHistoryView);
  document.getElementById("riwayat-date-end").addEventListener("change", renderHistoryView);
  document.getElementById("btn-jump-to-kasbon").addEventListener("click", () => switchTab("kasbon"));
  // Ekspor Laporan Transaksi & Laba (Rentang Tanggal)
  document.getElementById("btn-open-export-report").addEventListener("click", openExportReportModal);
  document.getElementById("btn-close-export-report").addEventListener("click", closeExportReportModal);
  document.getElementById("btn-cancel-export-report").addEventListener("click", closeExportReportModal);
  document.querySelectorAll(".export-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyExportDatePreset(btn.dataset.exportPreset));
  });
  document.getElementById("export-date-start").addEventListener("change", updateExportReportPreview);
  document.getElementById("export-date-end").addEventListener("change", updateExportReportPreview);
  document.getElementById("export-cashier-select").addEventListener("change", updateExportReportPreview);
  document.getElementById("form-export-report").addEventListener("submit", handleExportReportSubmit);

  // Modal Detail Transaksi & Retur
  document.getElementById("btn-close-tx-detail").addEventListener("click", closeTxDetailModal);
  document.getElementById("btn-tx-detail-reprint").addEventListener("click", () => {
    const tx = state.transactions.find((t) => t.id === activeDetailTxId);
    if (tx) openReceiptModal(tx);
  });
  document.getElementById("btn-tx-detail-void").addEventListener("click", openVoidAuthModal);
  document.getElementById("btn-close-void-auth").addEventListener("click", closeVoidAuthModal);
  document.getElementById("btn-cancel-void-auth").addEventListener("click", closeVoidAuthModal);
  document.getElementById("form-void-auth").addEventListener("submit", handleConfirmVoidTransaction);

  // Buku Kasbon / Piutang Pelanggan
  document.getElementById("debt-search-input").addEventListener("input", renderDebtsView);
  document.getElementById("debt-status-filter").addEventListener("change", renderDebtsView);
  document.getElementById("btn-debt-pay-full").addEventListener("click", () => {
    const debt = state.debts.find((d) => d.id === document.getElementById("pay-debt-id").value);
    if (debt) document.getElementById("pay-debt-amount").value = debt.remainingAmount;
  });
  document.getElementById("btn-close-debt-payment").addEventListener("click", closeDebtPaymentModal);
  document.getElementById("btn-cancel-debt-payment").addEventListener("click", closeDebtPaymentModal);
  document.getElementById("form-debt-payment").addEventListener("submit", handleSaveDebtPayment);

  document.getElementById("btn-open-manual-debt").addEventListener("click", openManualDebtModal);
  document.getElementById("btn-close-manual-debt").addEventListener("click", closeManualDebtModal);
  document.getElementById("btn-cancel-manual-debt").addEventListener("click", closeManualDebtModal);
  document.getElementById("form-manual-debt").addEventListener("submit", handleSaveManualDebt);

  // Sub-Menu Pengaturan Admin (Struk, Akun, & Cloud)
  document.getElementById("btn-subtab-receipt").addEventListener("click", () => switchSettingsSubtab("receipt"));
  document.getElementById("btn-subtab-users").addEventListener("click", () => switchSettingsSubtab("users"));
  document.getElementById("btn-subtab-cloud").addEventListener("click", () => switchSettingsSubtab("cloud"));

  // Form & Tombol Sinkronisasi Cloud Supabase
  document.getElementById("form-cloud-settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    cloudConfig.supabaseUrl = document.getElementById("cloud-supabase-url").value.trim();
    cloudConfig.supabaseAnonKey = document.getElementById("cloud-supabase-key").value.trim();
    cloudConfig.autoSync = document.getElementById("cloud-auto-sync").checked;
    saveCloudConfigToStorage();

    if (isCloudConfigured()) {
      await syncAllToCloud(false);
    } else {
      showToast("Konfigurasi Cloud disimpan (URL/Key kosong).", "info");
    }
  });

  document.getElementById("btn-sync-now").addEventListener("click", () => syncAllToCloud(false));
  document.getElementById("btn-restore-from-cloud").addEventListener("click", restoreAllDataFromCloud);

  // Otomatis sinkronkan saat perangkat kembali terhubung ke internet
  window.addEventListener("online", () => {
    updateCloudStatusUI();
    if (isCloudConfigured() && cloudConfig.autoSync) {
      syncAllToCloud(true);
    }
  });
  window.addEventListener("offline", updateCloudStatusUI);
  
  // Tarik & gabungkan data terbaru dari perangkat lain secara berkala setiap 30 detik
  if (isCloudConfigured() && cloudConfig.autoSync && navigator.onLine) {
    syncAllToCloud(true);
  }
  periodicSyncInterval = setInterval(() => {
    if (isCloudConfigured() && cloudConfig.autoSync && navigator.onLine) {
      syncAllToCloud(true);
    }
  }, 30000);

  // Manajemen Akun Kasir (Admin)
  document.getElementById("form-add-account").addEventListener("submit", handleAddAccount);
  document.getElementById("btn-close-edit-account").addEventListener("click", closeEditAccountModal);
  document.getElementById("btn-cancel-edit-account").addEventListener("click", closeEditAccountModal);
  document.getElementById("form-edit-account").addEventListener("submit", handleSaveEditAccount);

  // Upload & Konversi Logo Hitam-Putih Monochrome
  document.getElementById("set-logo-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const paperSize = document.getElementById("set-paper-size").value;
      tempLogoDataUrl = await processLogoImageToMonochrome(file, paperSize);
      updateLogoSettingsUI(tempLogoDataUrl);
      updateReceiptLivePreview();
      showToast("Logo dikonversi ke hitam-putih thermal!", "success");
    } catch (err) {
      showToast(err.message || "Gagal memproses logo.", "error");
    }
  });

  document.getElementById("btn-remove-logo").addEventListener("click", () => {
    tempLogoDataUrl = "";
    document.getElementById("set-logo-file").value = "";
    updateLogoSettingsUI("");
    updateReceiptLivePreview();
  });

  // Live Preview untuk seluruh teks, ukuran kertas, dan 9 sakelar struk
  document.getElementById("form-receipt-settings").addEventListener("submit", handleSaveReceiptSettings);
  [
    "set-paper-size",
    "set-store-name",
    "set-store-slogan",
    "set-store-address",
    "set-store-phone",
    "set-footer-line1",
    "set-footer-line2",
    "set-show-logo",
    "set-show-address-phone",
    "set-show-cashier",
    "set-show-receipt-datetime",
    "set-show-customer",
    "set-show-item-discount",
    "set-show-total-savings",
    "set-show-payment-details",
    "set-show-footer"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", updateReceiptLivePreview);
      el.addEventListener("change", updateReceiptLivePreview);
    }
  });

  // Tes Cetak Printer Bluetooth dari Pengaturan
  document.getElementById("btn-test-bluetooth-print").addEventListener("click", () => {
    const sampleTx = {
      id: "TEST-PRINT",
      timestamp: new Date().toISOString(),
      cashierName: state.currentUser ? state.currentUser.name : "Admin",
      customerName: "Pelanggan Tes",
      items: [
        { name: "Tes Koneksi Printer Thermal", qty: 1, price: 10000, itemDiscountAmount: 0, netSubtotal: 10000 }
      ],
      subtotalAmount: 10000,
      cartDiscountAmount: 0,
      totalAmount: 10000,
      paymentMethod: "cash",
      cashReceived: 10000,
      changeAmount: 0
    };
    printReceiptViaBluetooth(sampleTx, getReceiptFormConfig());
  });

  // Modal Struk: Cetak Bluetooth, Kirim WhatsApp, & Tutup
  document.getElementById("btn-print-bluetooth").addEventListener("click", () => {
    printReceiptViaBluetooth(activeReceiptTx);
  });
  document.getElementById("btn-send-whatsapp").addEventListener("click", () => {
    sendReceiptToWhatsApp(activeReceiptTx);
  });
  document.getElementById("btn-close-receipt-modal").addEventListener("click", closeReceiptModal);
  document.getElementById("btn-done-receipt").addEventListener("click", closeReceiptModal);

  // Tampilkan layar sesuai status login
  if (state.currentUser) {
    completeLogin(state.currentUser);
  } else {
    renderLoginScreen();
  }
});
