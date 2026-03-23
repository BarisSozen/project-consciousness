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

## SCOPE

**Ne inşa ediyoruz**: Basit bir Node.js CLI hesap makinesi

**Stack**: TypeScript + Node.js

**Başarı Kriterleri**:
- npm test geçmeli
- Toplama çalışmalı
- Çıkarma çalışmalı
- Çarpma çalışmalı
- Bölme çalışmalı

## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- `MISSION.md`
- `ARCHITECTURE.md`

**Kilitli kararlar**:
- D001 Dosya tabanlı hafıza sistemi

**Yasaklı bağımlılıklar**:
- `lodash`

**Kabul edilemez kırılmalar**:
- Mevcut testler kırılmasın

## SUCCESS CRITERIA

1. npm test geçmeli
2. Toplama çalışmalı
3. Çıkarma çalışmalı
4. Çarpma çalışmalı
5. Bölme çalışmalı

> Brief toplama tarihi: 2026-03-23T22:10:30.022Z
