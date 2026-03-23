# GLOSSARY — Project Consciousness

> Projede kullanılan temel terimler ve kavramlar.
> Her terim için kısa tanım ve kaynak modül/dosya bilgisi verilmiştir.

---

## 1. MISSION.md

Projenin değişmez varlık sebebini tanımlayan dosya. Neden bu sistemi inşa ettiğimizi, başarı tanımını ve kapsam dışı kalanları içerir. **Hiçbir agent veya otomasyon bu dosyayı değiştiremez** — sadece insan düzenler.

- **Yaşadığı yer**: `MISSION.md` (proje kökü)
- **Erişim modu**: Salt okunur (read-only)

---

## 2. ARCHITECTURE.md

Teknik mimari ve katman yapısını tanımlayan dosya. Stack seçimleri, katman sorumlulukları, tasarım ilkeleri ve dosya formatlarını içerir. Yavaş değişir; her değişiklik DECISIONS.md'ye loglanır.

- **Yaşadığı yer**: `ARCHITECTURE.md` (proje kökü)
- **Erişim modu**: Değişiklik önerisi üretilir, onay beklenir

---

## 3. DECISIONS.md

Projede alınan her mimari ve teknik kararın kronolojik kaydı. Append-only prensiple çalışır — kararlar asla silinmez, yalnızca `superseded` olarak işaretlenebilir.

- **Yaşadığı yer**: `DECISIONS.md` (proje kökü)
- **Erişim modu**: Append-only (sadece ekleme)

---

## 4. STATE.md

Projenin canlı durumunu tutan dosya. Aktif görevler, tamamlanan görevler, bloklanan işler ve mevcut fazı gösterir. Her task sonrası otomatik güncellenir.

- **Yaşadığı yer**: `STATE.md` (proje kökü)
- **Erişim modu**: Her task sonrası güncellenir

---

## 5. Orchestrator

Brief'ten plan çıkaran, agent çıktılarını değerlendiren ve gerektiğinde insana eskalasyon yapan merkezi yönetim birimi. Üç alt bileşenden oluşur: **Planner**, **Evaluator** ve **Escalator**.

- **Yaşadığı yer**: `src/orchestrator/` — `orchestrator.ts`, `planner.ts`, `evaluator.ts`, `escalator.ts`

---

## 6. Agent Runner

Claude Code instance'larını (`claude --print`) child process olarak spawn eden ve yöneten modül. Task context'ini hazırlar, hafıza snapshot'ını enjekte eder, çıktıyı parse edip orchestrator'a iletir.

- **Yaşadığı yer**: `src/agent/` — `agent-runner.ts`, `process-spawner.ts`, `context-builder.ts`, `output-parser.ts`

---

## 7. Memory Layer

Dört hafıza dosyasının (MISSION, ARCHITECTURE, DECISIONS, STATE) okuma/yazma işlemlerini yöneten guardian katman. Her dosyanın erişim kurallarını (salt okunur, append-only, vb.) uygular.

- **Yaşadığı yer**: `src/memory/` — `memory-layer.ts`

---

## 8. Memory Snapshot

Tüm hafıza dosyalarının (MISSION + ARCHITECTURE + DECISIONS + STATE) belirli bir andaki birleşik kopyası. Agent'lara context injection sırasında gönderilir. 30K karakter üstünde compact mod aktif olur.

- **Yaşadığı yer**: `src/agent/context-builder.ts` tarafından üretilir

---

## 9. Escalation

Agent'ın veya orchestrator'ın tek başına çözemediği durumlarda insan müdahalesine başvurma mekanizması. Düşük tutarlılık skoru, belirsiz kararlar veya kapsam dışı talepler eskalasyon tetikleyicileridir.

- **Yaşadığı yer**: `src/orchestrator/escalator.ts`

---

## 10. Context Injection

Agent prompt'una hafıza snapshot'ının, agent persona bilgisinin, task detayının ve çıktı formatının enjekte edilmesi süreci. Her agent çağrısında tam bağlam sağlanır, böylece hafıza kaybı önlenir.

- **Yaşadığı yer**: `src/agent/context-builder.ts`
