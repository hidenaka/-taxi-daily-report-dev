# 認証・アカウント・課金・権限のルール（必読）

> このドキュメントは、認証(auth)・userId・課金(subscription)・権限(company/admin)まわりを
> いじる前に**必ず読む**こと。過去にこの4領域の分岐がちぐはぐになり、ログインループ・
> 「サンプルデータ」誤表示・無料付与が `no_company` で弾かれる等の事故が連鎖した。
> 関連実装: `js/firebase-auth.js` / `js/firebase-storage.js` / `js/auth-state.js` /
> `js/subscription-state.js` / `js/access-control.js` / `firestore.rules` /
> `worker/src/index.js`（Cloudflare Worker `cabis-billing`）。

---

## 0. いちばん大事な不変条件（破ると事故る）

1. **認証判定は SDK の `auth.currentUser` を信じる。モジュール変数 `currentUser` は復元が遅れる。**
   永続セッション(IndexedDB)の復元は表示後 ~300ms 遅れる。初回 `onAuthStateChanged(null)` を
   「未ログイン」と誤認して `signInAnonymously` すると、復元中のメールセッションを匿名で上書きし、
   重複ユーザーdoc・ログインループを生む。→ `initAuth` は必ず `await auth.authStateReady()` 後に
   判定し、それでも null かつ登録IDが残るなら最大2sの猶予待ち（後述2-B）。
   UI のログイン判定も `isEmailAuth()`（= `auth.currentUser && !auth.currentUser.isAnonymous`、
   SDK直読み）を使う。`getCurrentUser()`/`isAuthenticated()` はモジュール変数なので遅延に注意。

2. **データは Firebase uid でなく `userId`（アプリ内ID）単位で保存する。**
   `drives/{userId}/daily/{date}`、`userConfigs/{userId}`、`timerStates/{userId}`、
   `subscriptions/{userId}`。uid ではない。だから匿名セッションでも `taxi_user_id` が正しければ
   そのユーザーのデータを読める（= admin強制切替の閲覧が成立する原理）。

3. **Firestore ルールのアクセス判定は `users/{uid}.userId`（= `myUserId()`）を見る。**
   `drives/userConfigs/timerStates/subscriptions` は `isOwnerByUserId(userId)`
   （`myUserId() == userId`）か `isAdmin()` で許可。
   → **どんな経路でも、データを読ませたいセッションには `users/{auth.uid}` doc が必要**。
   匿名セッション(admin閲覧含む)でも `users/{uid}.userId` を書かないとルールに弾かれる。
   （※2026-06-29に「登録IDを名乗る匿名は doc を書かない」ガードを入れたら、まさにこれで
   admin閲覧の読取が壊れた。書かないのは誤り。書く。）

4. **`userId` の一意性は「本物(メール登録)アカウントは同一userIdで1件だけ」という弱い形でのみ成立。**
   `createUserWithEmailAndPassword` がメール重複で失敗するため、`isAnonymous=false` の users doc は
   userId ごとに最大1件。ただし**匿名doc は同じ userId を複数持ちうる**（admin強制切替の閲覧が
   毎回1件作る）。→ userId で users を引くサーバー処理は、**匿名strayを無視して isAnonymous!==false を
   優先**して解決すること（`findCompanyIdByUserId` 参照）。「件数==1でなければ null」は誤り。

5. **`subscriptions` はクライアントから書けない（ルールで admin のみ）。必ず Worker 経由。**
   申込/無料付与/解約/webhook同期はすべて Worker(`cabis-billing`) がサービスアカウントで書く。

---

## 1. 定数（混同しない）

| 定数 | 値 | 定義 | 意味 |
|---|---|---|---|
| `DEFAULT_ANONYMOUS_USER_ID` | `user_sample` | `js/firebase-auth.js` | **未ログイン/ゲストの既定userId**（サンプルデータ閲覧用の共有ゲスト） |
| `SAMPLE_GUEST_USER_ID` | `user_sample` | `js/auth-state.js` | バッジが「サンプル」と表示する唯一のID（上と一致させる） |
| `DEFAULT_USER_ID` | `user_self` | `js/userid.js` | `getMyUserId()` のフォールバック。**これは smell**（下記） |
| `GRANDFATHERED_USERS` | `['user_self','mm']` | `js/subscription-state.js` | 課金免除の**実ユーザー**（旧来利用者） |

> ⚠️ **smell（既知の課題・要整理）**: `user_self` が「課金免除の実アカウント」と
> 「`getMyUserId()` の未設定フォールバック既定」の二役を持つ。実運用では `getMyUserId()` は
> `initAuth` 後 `currentUser`/`localStorage` から `user_sample` を返すためフォールバックは
> ほぼ発火せず、ゲストが免除化する事故は今は踏まれていない。が、**新規にゲスト既定を扱う
> コードを書くときは必ず `user_sample` を使い、`user_self` をフォールバックに使わない**こと。
> 将来 `getMyUserId()` のフォールバックを `user_sample` に統一するのが望ましい。

---

## 2. `initAuth()` の状態マシン（`js/firebase-auth.js`）

`await auth.authStateReady()` の後の `auth.currentUser` で分岐する。

```
authStateReady 後の auth.currentUser:
├─ user あり
│  ├─ メール認証(email が @taxi.local) → currentUserId = email先頭。localStorage保存。終了
│  ├─ 匿名 + localStorage に有効 userId → currentUserId = それ。users/{uid} を書く(ルール用)。終了
│  └─ 匿名 + localStorage 無し → users/{uid}.userId or user_sample で確定。書く。終了
└─ user null
   ├─ localStorage が「登録済みっぽい」(user_sample以外) → 最大2s 猶予待ち(B)
   │     遅延復元でメールユーザーが来たら上の「user あり」へ合流(クロバー阻止)
   └─ 来なければ / もともとゲスト → signInAnonymously()
         currentUserId = localStorage の userId(あれば=admin閲覧の対象) or user_sample
         users/{uid} を書く(ルール用)。終了
```

**(A) なぜ匿名でも users doc を書くのか** → §0-3。ルールが `myUserId()` を要求するから。
**(B) なぜ猶予待ちが要るのか** → `authStateReady` が稀に復元前 null を返す端末向けの二段防御。
admin強制切替/通常ログアウトは復元が来ないので2s後に匿名へ進む（= 機能を殺さない）。

### 関数の state source（重要）
| 関数 | source | 用途 |
|---|---|---|
| `isEmailAuth()` | **SDK** `auth.currentUser` | ログイン判定はこれ（遅延に強い） |
| `getUserId()` | module `currentUserId` ‖ localStorage | データキー用 userId |
| `getCurrentUser()` / `isAuthenticated()` | module `currentUser` | 遅延あり。判定の主軸にしない |
| `getMyUserId()` (storage) | `getUserId()` ‖ localStorage ‖ `user_self` | UI表示用。フォールバックは smell |

---

## 3. アカウント状態 → バッジ表示（`js/auth-state.js` `resolveAuthBadge`）

判定は「匿名か否か」ではなく「**実 userId のデータを見ているか**」。
（admin閲覧は匿名セッションだが実データを見ているので「サンプル」にしてはいけない。）

| 入力 | kind | 文言 | ログインフォーム |
|---|---|---|---|
| `emailAuthed=true` | login | ログイン中 | 出さない（ログアウト表示） |
| `emailAuthed=false` かつ `myId` が user_sample 以外 | viewing | `{myId} のデータを表示中` | 出さない |
| `emailAuthed=false` かつ `myId`=user_sample/空 | sample | サンプルデータ（ログインしてください） | 出す |

新たに「ログインしてください」系UIを足すときは、必ず `resolveAuthBadge` の kind で出し分ける。
`isAnonymous` 単体で判定すると admin閲覧で誤表示する。

---

## 4. サブスク状態の真理値表（`js/subscription-state.js` / `js/access-control.js`）

`getSubscription()` は `subscriptions/{userId}` を読む（無ければ grandfathered判定→なければ null）。

| status | isPaying | isCanceledOrUnpaid | requiresOnboarding | core | analysis/export |
|---|---|---|---|---|---|
| null（未申込） | × | × | ✅ | × | × |
| pending（申込途中） | × | × | ✅ | × | × |
| trial | ✅ | × | × | ✅ | ✅ |
| active | ✅ | × | × | ✅ | ✅ |
| past_due（支払遅延） | × | × | × | ✅(coreのみ) | × |
| canceled / unpaid | × | ✅ | × | × | × |

無料付与/grandfathered は `status='active'`（+ `free:true` / `planId='comp_company'` /
`grandfathered_v1`）として表現し、上表の active と同じ扱いで全機能可（= 想定どおり）。
`plan` 未設定時は `getPlanTier` が `'full'` 既定（無料/免除はフル機能の意図）。

UI（`index.html initOnboardBanner` / `subscribe.html applyAccountState` / `settings.html`）の
サブスク分岐は、必ずこの表と一致させる。`isPaying` だけで分岐すると `past_due` が申込フォームへ
落ちる等の不整合になる（既知の改善余地・§6）。

**キャッシュ**(`js/sub-cache.js`): `sessionStorage`・userId名前空間・TTL90s・
ログアウト/切替/申込/退会で `clearSubCache()`。クロスユーザー漏れ対策済み。

---

## 5. 権限マトリクス（`firestore.rules` / Worker）

| コレクション | 一般ユーザー read | 一般ユーザー write | 備考 |
|---|---|---|---|
| `users/{uid}` | 自分のuidのみ | 自分のuidのみ | **userId フィールドは本人が書ける**（§7のリスク源） |
| `drives|userConfigs|timerStates/{userId}` | `myUserId()==userId` | 同左 | admin は全許可 |
| `subscriptions/{userId}` | `myUserId()==userId` | **不可** | 書込みは admin/Worker のみ |
| `companies/{companyId}` | **誰でも(匿名可)** | 不可 | 招待URL検証用。slugは匿名化(co-XXXXXX) |
| `companies/.../stands` | `myCompanyId()==companyId` | 不可 | 編集は admin |
| `userRoles/{userId}` | 全員 | 不可 | role は秘密でない |
| `groups/{id}` `groups/.../pool` | メンバーのみ | 不可(Worker) | §6: 会社分離なし |
| `adminUids/{uid}` | 自分のみ | 不可 | Console から手動seed |

### 無料付与フロー（会社招待 freeForInvited）
1. 招待リンク `?company=<slug>` → 登録 → `users/{uid}.companyId = slug`。
2. ユーザーが subscribe で「無料で利用開始」→ クライアント `startFree()` →
   Worker `POST /start-free {userId, agreement:{...}}`。
3. Worker は `findCompanyIdByUserId(userId)` で会社解決 → `companies/{id}.freeForInvited===true`
   をサーバー検証 → `subscriptions/{userId}` に `status:active, planId:comp_company, free:true`。
4. **管理者が代理付与する場合**も同じエンドポイントを叩けばよい（会社フラグをサーバー検証）。
   規約版は `subscribe.html` の `AGREEMENT_VERSIONS`（現行 `2026-05-08`）を渡す。
   例: `curl -X POST https://cabis-billing.haqei64384.workers.dev/start-free
   -d '{"userId":"X","agreement":{"termsVersion":"2026-05-08",...}}'`

### `findCompanyIdByUserId` の鉄則（§0-4）
匿名strayを無視し `isAnonymous!==true` を優先。これに依存するのは start-free /
notify-signup / グループ操作の userId 解決。**userId で users を引く新コードは必ずこの方式で。**

### Webhook 保護（`syncSubscription`）
`free:true` または `planId='comp_company'` のサブスクは Stripe webhook で上書きしない
（無料グラントを課金webhookが壊さないため）。

---

## 6. 既知の改善余地（壊れてはいないが整理推奨）

- **past_due の告知不足**: `canAccess` は core のみ許可するが、UI が支払催促を出さず申込フォームへ
  落ちる。`initOnboardBanner`/`applyAccountState` に past_due 分岐を足すと親切。
- **admin判定が3箇所で別実装**: `firestore.rules`=`adminUids` 存在 / `admin.html`=`userId==='admin'`
  ハードコード / Worker=`ADMIN_UIDS` 環境変数。セキュリティの実体はルール+Workerで、admin.html の
  ハードコードは UI ゲートにすぎないが、揃えると混乱が減る。
- **role の保存先が2系統**: `userRoles/{userId}` と `users/{uid}.role`。真実の源を1つに。
- **group に companyId が無い**: 会社間でグループ混在が原理上可能。会社分離が要件なら付与。
- **`plan` フィールドが無料/免除で未設定**（既定full）: 意図的だが、Worker/grandfathered生成で
  明示 `plan:'full'` を書くと意図が読み取りやすい。

---

## 7. 構造リスク（要・設計判断）

**`users/{uid}.userId` は本人が書き換えられ、それがデータアクセス権の根拠になっている。**
ルール `isOwnerByUserId` は `users/{auth.uid}.userId == 対象userId` で許可するが、`users/{uid}` は
本人が write 可能（`request.auth.uid==uid`）。つまり**任意のログインユーザーが自分の users doc の
userId を他人のIDに書き換えれば、その他人の drives/userConfigs を読み書きできる**。
admin強制切替(なりすまし閲覧)はこれを意図的に使った機能だが、**一般ユーザーにも同じ穴が空いている**
（他人の userId を知っていれば、の前提付き。userId は基本秘匿だが保証ではない）。

- 影響: データ分離が「userId を知らない」ことだけに依存している。
- 恒久対策の方向（要判断・大きめ）:
  1. 閲覧/編集を uid ベースに寄せ、userId↔uid の対応をサーバー(Worker/カスタムクレーム)で検証する。
  2. admin閲覧は「ログアウトして匿名でなりすます」のをやめ、admin の認証を保ったまま `isAdmin()`
     ルールで対象データを読む方式に変える（匿名doc重複も無くなる）。
  3. 最低限、`setMyUserId`/アカウント切替UI を admin 専用に制限する。
- 現状は既存挙動を壊さないため未対応。新機能でこの穴を広げない / 重要データを足すときは上記を検討。

---

## 8. 変更時の必須チェックリスト

- [ ] 認証判定を足すなら SDK `auth.currentUser`/`isEmailAuth()` を使ったか（module変数でないか）
- [ ] 匿名でもデータを読ませるなら `users/{uid}.userId` が書かれる経路か（ルール §0-3）
- [ ] userId で users を引くなら匿名stray対応(`isAnonymous!==true`優先)したか（§0-4）
- [ ] ゲスト既定は `user_sample` を使ったか（`user_self` をフォールバックにしていないか）
- [ ] サブスク分岐は §4 の真理値表と一致するか
- [ ] `subscriptions` をクライアントから書こうとしていないか（Worker経由か）
- [ ] デプロイ: クライアント=`dpush.sh`→`tagpush.sh vX.Y.Z`、Worker=`wrangler deploy(:prod)`、
      ルール=`firebase deploy --only firestore:rules [--project=prod]`。SWキャッシュ版 bump 必須。
- [ ] 本番反映後、`?cb=` でCDN迂回し新版到達を確認（GitHub Pages のパス別伝播ラグ対策）
