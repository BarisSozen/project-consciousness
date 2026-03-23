# MISSION — Project Consciousness

> Bu dosya asla otomatik değiştirilmez. Sadece insan düzenler.

## Neden Varız

Multi-agent sistemlerde en büyük sorun **hafıza kaybı**dır.
Agent'lar uzun süre çalıştıkça "neden bu projeyi yapıyoruz"
sorusunun cevabını unutur, tutarsız kararlar alır, misyondan sapar.

## Ne İnşa Ediyoruz

**Dosya tabanlı dış hafıza sistemi + orchestrator agent.**

Dört kalıcı dosya üzerinden çalışan bir orkestrasyon katmanı:
- Agent'lar her adımda misyonu, mimariyi, geçmiş kararları okur
- Orchestrator her çıktıyı bu bağlama karşı değerlendirir
- Tutarsızlık tespit edilirse düzeltir veya insana sorar

## Başarı Tanımı

1. Kullanıcı başta **bir kez** brief verir
2. Orchestrator planı çıkarır, agent'ları yönetir
3. Agent'lar çalışır, orchestrator tutarlılığı denetler
4. Kullanıcı sadece eskalasyonda dahil olur
5. Proje tamamlanır, insan "evet bu istediğimdi" der

## Kullanıcı Kim

Developer değil, ürün ve sistem düşünürü.
Kod yazmıyor ama mimariyi anlıyor.
Claude Code + GSD-2 ile çalışıyor.

## Kapsam Dışı

- Dashboard / UI yok
- Karmaşık altyapı yok (DB, message queue, vb.)
- GSD-2'yi replace etmiyor, üstüne oturuyor
- Paperclip kadar ağır bir sistem değil
