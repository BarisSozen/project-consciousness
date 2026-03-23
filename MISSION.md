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

**Ne inşa ediyoruz**: Basit bir TODO REST API (in-memory, express)

**Stack**: TypeScript + Node.js

**Başarı Kriterleri**:
- npm test geçmeli
- GET /todos çalışmalı
- POST /todos çalışmalı
- DELETE /todos/:id çalışmalı

## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- `MISSION.md`

**Kilitli kararlar**:
- _(yok)_

**Yasaklı bağımlılıklar**:
- `fastify`
- `koa`
- `hapi`
- `lodash`

**Kabul edilemez kırılmalar**:
- Mevcut testler kırılmasın

## SUCCESS CRITERIA

1. npm test geçmeli
2. GET /todos çalışmalı
3. POST /todos çalışmalı
4. DELETE /todos/:id çalışmalı

> Brief toplama tarihi: 2026-03-23T22:27:35.982Z
