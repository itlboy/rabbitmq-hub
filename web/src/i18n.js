// Tiny i18n: English + Vietnamese. Default comes from config.locale (via /api/me), the viewer's choice is remembered per browser.
import { ref } from 'vue';
import { store } from './format.js';

export const LANGS = { en: 'EN', vi: 'VI' };
export const lang = ref(store.get('hub.lang') || 'en');
let userChose = !!store.get('hub.lang');
export function setLang(l, byUser = true) {
  if (!LANGS[l]) return;
  if (!byUser && userChose) return;
  lang.value = l; document.documentElement.lang = l;
  if (byUser) { userChose = true; store.set('hub.lang', l); }
}

const D = {
  en: {
    healthy: '{n}/{n} healthy', attention: '{bad}/{n} need attention →', jump_to: 'Jump to {names}',
    refresh_now: 'Refresh now (auto every {s}s)', connecting: 'connecting', pause: 'Pause', paused: 'Paused',
    range: 'History', r10m: '10 min', r1h: '1 hour', r8h: '8 hours', last: 'last {r}',
    theme_light: 'Light theme', theme_system: 'Match system theme', theme_dark: 'Dark theme',
    connecting_clusters: 'Connecting to clusters…', loading: 'Loading',
    flow: 'Flow', msgs_in: '{r} msg/s in', waiting: 'waiting', out: 'out', in: 'in', shovels_short: 'sh',
    msg: 'msg', queues: 'queues', conns: 'conns', shovels: 'shovels', nodes: 'nodes', ram: 'ram', disk: 'disk', cpu: 'cpu',
    show_nodes: 'Show every node', running_total: 'running / total', ram_tip: 'highest node, % of memory watermark',
    disk_tip: 'lowest free space of any node', cpu_tip: 'highest load (run queue ÷ cores); above 1 = CPU saturated',
    tab_queues: 'Queues', tab_shovels: 'Shovels', read_only: 'read-only', open_ui: 'Management', open_ui_tip: 'Open the RabbitMQ management UI in a new tab', filter: 'filter queues',
    hide_minor: 'Hide minor', home: 'Home', hidden_minor: '{n} minor queues hidden (delay/retry) · {m} messages, counted in the waiting total. Show them', with_messages: 'With messages',
    col_queue: 'Queue', col_type: 'Type', col_depth: 'Depth', col_ready: 'Ready', col_unacked: 'Unacked',
    col_consumers: 'Consumers', col_in: 'In/s', col_out: 'Out/s', empty_btn: 'Empty',
    loading_queues: 'Loading queues…', no_match: 'No queues match these filters.', no_queues: 'This cluster has no queues yet.',
    pick_cluster: 'Pick a cluster to read its queues.',
    stuck_tip: 'Ready messages untouched for 10 minutes and no consumer — is any worker reading this queue?',
    polling_tip: 'No consumer attached, but workers are taking messages (polling with basic.get)',
    col_shovel: 'Shovel', col_state: 'State', col_node: 'Node', col_from: 'From queue', col_to: 'To', col_error: 'Last error',
    loading_shovels: 'Loading shovels…', no_shovels: 'No shovels on this cluster.',
    close: 'Close', depth_now: 'depth now', consumers_n: '{n} consumers', on_every_cluster: 'This queue on every cluster',
    checking_clusters: 'Checking every cluster…', not_declared: 'not declared here', no_shovel: 'no shovel', shovel_state: 'shovel {s}',
    read_messages: 'Read messages', read_n: 'Read {n}', peek_hint: 'Messages go straight back (marked redelivered). Every read is logged.', peek_off: 'Reading messages is turned off for this cluster.',
    peek_role: 'Reading message bodies needs admin or peeker access.',
    peek_warn: 'Messages are taken from the head of the queue and put straight back. They get the redelivered flag and may change order.',
    peek_warn_q: ' On this quorum queue every read also counts as a delivery attempt — repeated reads can push a message past its delivery limit.',
    peek_logged: ' Every read is logged.', show_first: 'Show first', messages: 'messages', reading: 'Reading…',
    queue_empty: 'The queue is empty.', none_back: 'No messages came back (the queue drained in the meantime).',
    copy: 'Copy', truncated: 'Body truncated to 64 KB (full size {n} B).', no_type: '(no type)',
    exchange: 'exchange', routing_key: 'routing key', type: 'type', mode: 'mode', persistent: 'persistent', transient: 'transient',
    nodes_title: 'nodes · RabbitMQ {v}', up_for: 'up {t}', stopped: 'stopped', cores: '{n} cores', load: 'load',
    sockets_files: 'sockets · files', free: 'free', limit: 'limit',
    nodes_down: '{d} of {n} node(s) stopped. The cluster keeps serving if the rest still form a majority, but redundancy is reduced.',
    node_alarm: 'A node has an alarm: publishers are blocked until it clears.',
    node_warn: 'All nodes running; one resource is getting close to its limit.', nodes_ok: 'All {n} node(s) running with plenty of headroom.',
    what_mean: 'What these mean',
    legend_colors: 'Green = well within limits · amber = getting close · red = at or over the limit, act now. Thresholds: RAM amber from 75%, red from 90% · Disk amber below 5× the limit, red below 2× · CPU load amber from 0.7, red from 1.',
    legend_ram: 'RAM — memory used as a share of the limit (watermark). At 100% RabbitMQ stops accepting new messages until memory drops; publishing apps slow down or time out. A big backlog is the usual cause.',
    legend_disk: 'Disk — free space for message data. Below the limit RabbitMQ blocks publishers to protect its data. Several times the limit free is comfortable.',
    legend_cpu: 'CPU load — processes waiting for a CPU core ÷ number of cores (RabbitMQ has no CPU %). Under 1 the CPU keeps up; over 1 work queues for the CPU and messages are handled late. In Kubernetes the core count is the whole machine\'s.',
    legend_conns: 'Conns — open client connections (apps, workers, shovels) and open files.',
    purge_title: 'Empty this queue?', purge_text: 'Every message waiting in this queue is deleted. Consumers keep running. This cannot be undone.',
    cluster: 'cluster', queue: 'queue', type_confirm: 'Type the queue name to confirm', cancel: 'Cancel',
    empty_queue: 'Empty queue', emptying: 'Emptying…', emptied: 'Emptied {q} · {n} messages deleted',
  },
  vi: {
    healthy: '{n}/{n} cụm ổn', attention: '{bad}/{n} cụm cần xem →', jump_to: 'Tới {names}',
    refresh_now: 'Làm mới ngay (tự động mỗi {s} giây)', connecting: 'đang kết nối', pause: 'Dừng', paused: 'Đã dừng',
    range: 'Lịch sử', r10m: '10 phút', r1h: '1 giờ', r8h: '8 giờ', last: '{r} qua',
    theme_light: 'Giao diện sáng', theme_system: 'Theo hệ thống', theme_dark: 'Giao diện tối',
    connecting_clusters: 'Đang kết nối tới các cụm…', loading: 'Đang tải',
    flow: 'Luồng', msgs_in: '{r} msg/s vào', waiting: 'đang chờ', out: 'ra', in: 'vào', shovels_short: 'sh',
    msg: 'msg', queues: 'queue', conns: 'kết nối', shovels: 'shovel', nodes: 'node', ram: 'ram', disk: 'ổ', cpu: 'cpu',
    show_nodes: 'Xem từng node', running_total: 'đang chạy / tổng', ram_tip: 'node cao nhất, % so với ngưỡng watermark',
    disk_tip: 'dung lượng trống thấp nhất trong các node', cpu_tip: 'tải cao nhất (run queue ÷ số core); trên 1 = CPU nghẽn',
    tab_queues: 'Queue', tab_shovels: 'Shovel', read_only: 'chỉ xem', open_ui: 'Management', open_ui_tip: 'Mở RabbitMQ Management ở tab mới', filter: 'lọc queue',
    hide_minor: 'Ẩn queue phụ', home: 'Trang chủ', hidden_minor: 'Đang ẩn {n} queue phụ (delay/chờ chạy lại) · {m} message, đã tính trong tổng đang chờ. Bấm để hiện', with_messages: 'Chỉ queue có message',
    col_queue: 'Queue', col_type: 'Loại', col_depth: 'Tồn', col_ready: 'Chờ', col_unacked: 'Đang xử lý',
    col_consumers: 'Consumer', col_in: 'Vào/s', col_out: 'Ra/s', empty_btn: 'Xoá hết',
    loading_queues: 'Đang tải danh sách queue…', no_match: 'Không có queue nào khớp bộ lọc.', no_queues: 'Cụm này chưa có queue nào.',
    pick_cluster: 'Chọn một cụm để xem queue.',
    stuck_tip: 'Message chờ suốt 10 phút mà không có consumer — có worker nào đọc queue này không?',
    polling_tip: 'Không có consumer đăng ký, nhưng worker vẫn đang lấy message (hỏi liên tục bằng basic.get)',
    col_shovel: 'Shovel', col_state: 'Trạng thái', col_node: 'Node', col_from: 'Từ queue', col_to: 'Tới', col_error: 'Lỗi gần nhất',
    loading_shovels: 'Đang tải shovel…', no_shovels: 'Cụm này không có shovel.',
    close: 'Đóng', depth_now: 'đang tồn', consumers_n: '{n} consumer', on_every_cluster: 'Queue này trên mọi cụm',
    checking_clusters: 'Đang kiểm tra từng cụm…', not_declared: 'chưa có ở cụm này', no_shovel: 'chưa có shovel', shovel_state: 'shovel {s}',
    read_messages: 'Đọc message', read_n: 'Đọc {n}', peek_hint: 'Message được trả lại ngay (đánh dấu redelivered). Mỗi lần đọc đều ghi log.', peek_off: 'Cụm này tắt chức năng đọc message.',
    peek_role: 'Đọc nội dung message cần quyền admin hoặc peeker.',
    peek_warn: 'Message được lấy từ đầu queue rồi trả lại ngay. Chúng bị gắn cờ redelivered và có thể đổi thứ tự.',
    peek_warn_q: ' Đây là quorum queue: mỗi lần đọc tính là một lần giao — đọc nhiều lần có thể làm message vượt giới hạn giao.',
    peek_logged: ' Mỗi lần đọc đều được ghi log.', show_first: 'Xem', messages: 'message đầu tiên', reading: 'Đang đọc…',
    queue_empty: 'Queue đang trống.', none_back: 'Không lấy được message nào (queue vừa được rút hết).',
    copy: 'Sao chép', truncated: 'Nội dung bị cắt còn 64 KB (đầy đủ {n} B).', no_type: '(không rõ loại)',
    exchange: 'exchange', routing_key: 'routing key', type: 'kiểu', mode: 'lưu', persistent: 'bền (đĩa)', transient: 'tạm (RAM)',
    nodes_title: 'các node · RabbitMQ {v}', up_for: 'đã chạy {t}', stopped: 'đã dừng', cores: '{n} core', load: 'tải',
    sockets_files: 'kết nối · file', free: 'trống', limit: 'giới hạn',
    nodes_down: '{d}/{n} node đã dừng. Cụm vẫn chạy nếu số node còn lại chiếm đa số, nhưng mất dự phòng.',
    node_alarm: 'Có node đang báo động: RabbitMQ chặn nhận message mới cho tới khi hết báo động.',
    node_warn: 'Mọi node đang chạy; có một tài nguyên sắp chạm giới hạn.', nodes_ok: 'Cả {n} node đang chạy, tài nguyên còn dư nhiều.',
    what_mean: 'Các chỉ số nghĩa là gì',
    legend_colors: 'Xanh = an toàn · vàng = sắp chạm ngưỡng · đỏ = vượt ngưỡng, cần xử lý ngay. Ngưỡng: RAM vàng từ 75%, đỏ từ 90% · Ổ đĩa vàng khi trống dưới 5 lần mức giới hạn, đỏ dưới 2 lần · Tải CPU vàng từ 0.7, đỏ từ 1.',
    legend_ram: 'RAM — bộ nhớ đã dùng so với giới hạn (watermark). Chạm 100% RabbitMQ ngừng nhận message mới cho tới khi RAM giảm; app gửi message sẽ chậm hoặc timeout. Nguyên nhân thường là message tồn quá nhiều.',
    legend_disk: 'Ổ đĩa — chỗ trống cho dữ liệu message. Xuống dưới mức giới hạn thì RabbitMQ chặn nhận message mới để bảo vệ dữ liệu. Trống gấp vài lần mức giới hạn là thoải mái.',
    legend_cpu: 'Tải CPU — số tiến trình đang chờ CPU ÷ số core (RabbitMQ không báo % CPU). Dưới 1 là CPU kịp xử lý; trên 1 là việc phải xếp hàng chờ CPU, message bị xử lý chậm. Trong Kubernetes số core là của cả máy.',
    legend_conns: 'Kết nối — số kết nối đang mở (app, worker, shovel) và số file đang mở.',
    purge_title: 'Xoá hết message trong queue?', purge_text: 'Toàn bộ message đang chờ trong queue sẽ bị xoá. Consumer vẫn chạy bình thường. Không thể khôi phục.',
    cluster: 'cụm', queue: 'queue', type_confirm: 'Gõ lại tên queue để xác nhận', cancel: 'Huỷ',
    empty_queue: 'Xoá hết', emptying: 'Đang xoá…', emptied: 'Đã xoá hết {q} · {n} message',
  },
};

export function t(key, vars = {}) {
  const s = (D[lang.value] && D[lang.value][key]) ?? D.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}
