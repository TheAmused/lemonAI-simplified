# LemonAI Hub — Simplified

## Nazwa kursu

**Testowanie i Jakość Oprogramowania**

## Autor

**WiktorS** (`TheAmused`)

## Temat projektu

**REST API centralnego repozytorium manifestów instalacyjnych i modeli AI**

## Opis projektu

Projekt stanowi centralne repozytorium (Hub) dla deklaratywnych manifestów instalacyjnych oraz katalogu modeli AI (LLM, generowanie obrazów, audio). System składa się z backendu REST API opartego na FastAPI oraz bazy danych PostgreSQL uruchamianych w kontenerach Docker, a także z webowego interfejsu użytkownika (React + Vite).

Główne funkcjonalności:
- Przeglądanie, filtrowanie i wyszukiwanie skatalogowanych modeli AI oraz ich wariantów.
- Rejestracja i uwierzytelnianie użytkowników (JWT + rotacja tokenów odświeżania, obsługa kont demo w trybie deweloperskim).
- Publikacja i rygorystyczna walidacja deklaratywnych manifestów instalacyjnych (ochrona przed niedozwolonymi flagami uruchomieniowymi, ścieżkami typu path traversal, niedozwolonymi pakietami i plikami pickle).
- Przesyłanie i serwowanie grafik podglądowych (PNG, JPEG, WebP, bezpieczny SVG) z izolacją nagłówków bezpieczeństwa.
- Moderacja i kuracja wpisów przez administratora.

## Uruchomienie projektu

### 1. Uruchomienie pełnego stosu w Dockerze (PostgreSQL + FastAPI + React UI)

```bash
cp .env.example .env
```

Uzupełnij w pliku `.env` zmienne `POSTGRES_PASSWORD`, `SECRET_KEY` oraz `JWT_SECRET_KEY` (np. generując je poleceniem `python -c "import secrets; print(secrets.token_urlsafe(48))"`), a następnie uruchom kontenery:

```bash
docker compose up --build
```

Po uruchomieniu usługi dostępne są pod adresami:
- **Interfejs użytkownika (React UI):** `http://localhost:1420`
- **REST API (FastAPI):** `http://127.0.0.1:5000`

### 2. Uruchomienie lokalne frontendu w trybie deweloperskim

```bash
cd frontend
npm install
npm run dev
```

## Testy

Wszystkie testy zostały napisane zgodnie z konwencją **AAA (Arrange–Act–Assert)** i uruchamiane są za pomocą `pytest`:

```bash
pytest backend/tests -q
```

### Testy jednostkowe (`12` testów)
Lokalizacja: [backend/tests/test_unit.py](backend/tests/test_unit.py)

Weryfikują izolowaną logikę domenową bez uruchamiania serwera HTTP ani bazy danych:
- blokowanie niebezpiecznych flag uruchomieniowych i akceptację dozwolonych flag (`is_forbidden_flag`),
- normalizację nazw pakietów Pythona zgodnie ze standardem PEP 503 (`normalize_package_name`),
- odrzucanie wartości `NaN` i `Infinity` przy parsowaniu JSON (`loads_strict`),
- walidację schematu manifestu, odrzucanie nieznanych pól, plików pickle i ścieżek traversal (`validate_manifest`),
- sprawdzanie standardów jakościowych opisów i podszywania się pod modele oficjalne (`check_standards`),
- haszowanie haseł i bezpieczną serializację modelu `User`.

### Testy integracyjne (`34` przypadki testowe)
Lokalizacje:
- [backend/tests/test_integration.py](backend/tests/test_integration.py) — testy endpointów REST API z bazą danych (konfiguracja i ochrona sekretów, CORS, wyłączenie `/docs` w trybie produkcyjnym, rejestracja, logowanie, rotacja i unieważnianie tokenów JWT, katalog modeli, publikacja manifestów i grafik, walidacja błędnych danych, kuracja administracyjna).
- [backend/tests/test_migrations.py](backend/tests/test_migrations.py) — testy cyklu migracji Alembic (`upgrade` / `downgrade`), integracji migracji z seedowaniem katalogu oraz obsługi istniejących schematów bazy danych.

## Dokumentacja API

Bazowy adres API: `http://127.0.0.1:5000`

### Uwierzytelnianie (`/api/auth`)
- `POST /api/auth/register` — rejestracja nowego konta (`username`, `email`, `password`).
- `POST /api/auth/login` — logowanie i uzyskanie pary tokenów (`access_token`, `refresh_token`).
- `POST /api/auth/refresh` — odświeżenie i rotacja tokenu dostępowego.
- `POST /api/auth/logout` — wylogowanie i unieważnienie tokenu odświeżania.
- `GET /api/auth/me` — pobranie danych aktualnie zalogowanego użytkownika.
- `GET /api/auth/demo-accounts` — lista kont demo (dostępna wyłącznie w trybie deweloperskim).

### Katalog i manifesty (`/api/scripts`)
- `GET /api/scripts` — lista modeli z obsługą paginacji i filtrów (`category`, `search`, `curated`, `adult`).
- `GET /api/scripts/{slug_or_id}` — szczegóły wybranego modelu wraz z manifestem.
- `POST /api/scripts` — publikacja nowego modelu i manifestu (`multipart/form-data`: `metadata` + opcjonalnie `preview_image`).
- `PUT /api/scripts/{slug}` — aktualizacja własnego wpisu przez autora.
- `DELETE /api/scripts/{slug}` — usunięcie własnego wpisu.
- `POST /api/scripts/{slug}/install` — rejestracja instalacji modelu.
- `PUT /api/scripts/{slug}/curation` — zmiana statusu kuracji wpisu (wymaga uprawnień administratora).
- `GET /api/uploads/images/{filename}` — pobranie bezpiecznie serwowanego obrazu podglądowego.

### Administracja, powiadomienia i wydania
- `GET /api/admin/scripts`, `POST /api/admin/scripts/{slug}/moderate` — panel i akcje moderacyjne administratora.
- `GET /api/notifications` — lista powiadomień zalogowanego użytkownika.
- `GET /api/releases/latest` — informacje o najnowszym wydaniu aplikacji.

## Przypadki testowe dla testera manualnego (TestCase)

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC001 |
| **Tytuł** | Wyświetlenie katalogu modeli po uruchomieniu aplikacji |
| **Warunki początkowe** | Kontenery Docker (`db`, `api`, `frontend`) są uruchomione; otwarta strona `http://localhost:1420`. |
| **Kroki testowe** | 1. Otwórz aplikację w przeglądarce.<br>2. Przejdź do zakładki **Katalog**.<br>3. Zaczekaj na załadowanie listy modeli. |
| **Oczekiwany rezultat** | W stopce widoczny jest status połączenia z Hubem, a lista wyświetla skatalogowane modele AI pobrane z API. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC002 |
| **Tytuł** | Wyszukiwanie modelu w katalogu po nazwie |
| **Warunki początkowe** | Użytkownik znajduje się w zakładce **Katalog** z załadowaną listą modeli. |
| **Kroki testowe** | 1. Kliknij pole wyszukiwania.<br>2. Wpisz frazę `Qwen`.<br>3. Sprawdź wyświetloną listę wyników. |
| **Oczekiwany rezultat** | Lista zostaje przefiltrowana i prezentuje wyłącznie modele pasujące do frazy `Qwen`. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC003 |
| **Tytuł** | Rejestracja nowego użytkownika z poprawnymi danymi |
| **Warunki początkowe** | Użytkownik jest wylogowany i znajduje się na stronie głównej. |
| **Kroki testowe** | 1. Kliknij przycisk **Zaloguj**.<br>2. Przełącz zakładkę na **Rejestracja**.<br>3. Wpisz unikalną nazwę użytkownika, poprawny adres e-mail i hasło (min. 8 znaków).<br>4. Zatwierdź formularz. |
| **Oczekiwany rezultat** | Okno logowania zamyka się, użytkownik zostaje zalogowany, a w menu bocznym pojawia się ikona profilu oraz powiadomień. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC004 |
| **Tytuł** | Odrzucenie rejestracji dla istniejącej nazwy użytkownika |
| **Warunki początkowe** | W bazie istnieje konto `demo_creator`; otwarta zakładka **Rejestracja**. |
| **Kroki testowe** | 1. Wpisz nazwę użytkownika `demo_creator`.<br>2. Podaj nowy adres e-mail oraz poprawne hasło.<br>3. Zatwierdź formularz rejestracji. |
| **Oczekiwany rezultat** | System wyświetla komunikat o błędzie informujący, że konto o podanej nazwie już istnieje; logowanie nie następuje. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC005 |
| **Tytuł** | Autouzupełnianie i logowanie na konto zwykłego użytkownika demo |
| **Warunki początkowe** | Tryb deweloperski włączony; otwarte okno **Logowanie**. |
| **Kroki testowe** | 1. Kliknij przycisk **Uzupełnij: Twórca modeli**.<br>2. Sprawdź pola formularza.<br>3. Kliknij **Zaloguj się**. |
| **Oczekiwany rezultat** | Pola loginu i hasła zostają automatycznie wypełnione bez natychmiastowego wysłania formularza, a po kliknięciu **Zaloguj się** użytkownik loguje się jako `demo_creator`. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC006 |
| **Tytuł** | Autouzupełnianie i logowanie na konto administratora |
| **Warunki początkowe** | Tryb deweloperski włączony; użytkownik jest wylogowany; otwarte okno **Logowanie**. |
| **Kroki testowe** | 1. Kliknij przycisk **Uzupełnij: Administrator**.<br>2. Kliknij **Zaloguj się**.<br>3. Otwórz menu **Twoje konto**. |
| **Oczekiwany rezultat** | Użytkownik loguje się jako `admin`, a w menu konta widoczna jest rola administratora oraz pozycja **Administracja**. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC007 |
| **Tytuł** | Próba logowania z błędnym hasłem |
| **Warunki początkowe** | W systemie istnieje konto `demo_creator`; otwarte okno **Logowanie**. |
| **Kroki testowe** | 1. Wpisz login `demo_creator`.<br>2. Wpisz błędne hasło `ZleHaslo123!`.<br>3. Kliknij **Zaloguj się**. |
| **Oczekiwany rezultat** | Logowanie kończy się niepowodzeniem, a formularz wyświetla komunikat o nieprawidłowych danych logowania. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC008 |
| **Tytuł** | Wylogowanie zalogowanego użytkownika |
| **Warunki początkowe** | Użytkownik jest zalogowany w aplikacji. |
| **Kroki testowe** | 1. Kliknij ikonę **Twoje konto**.<br>2. Wybierz opcję **Wyloguj**. |
| **Oczekiwany rezultat** | Sesja zostaje zakończona, a w menu bocznym ponownie pojawia się przycisk **Zaloguj**. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC009 |
| **Tytuł** | Otwarcie formularza publikacji nowego modelu i manifestu |
| **Warunki początkowe** | Użytkownik jest zalogowany i znajduje się w zakładce **Katalog**. |
| **Kroki testowe** | 1. Kliknij przycisk **Opublikuj model**.<br>2. Sprawdź widoczność pól formularza. |
| **Oczekiwany rezultat** | Otwiera się modal publikacji zawierający pola nazwy, slugu, kategorii, runnera, repozytorium Hugging Face, wymagań sprzętowych, opisu oraz załącznika grafiki. |

| Pole | Wartość |
| :--- | :--- |
| **ID** | TC010 |
| **Tytuł** | Walidacja zbyt krótkiego opisu podczas publikacji modelu |
| **Warunki początkowe** | Otwarty modal **Opublikuj model**; użytkownik jest zalogowany. |
| **Kroki testowe** | 1. Wpisz nazwę modelu oraz poprawne repozytorium Hugging Face.<br>2. W polu **Opis modelu i zastosowanie** wpisz tekst krótszy niż 40 znaków.<br>3. Kliknij przycisk **Opublikuj**. |
| **Oczekiwany rezultat** | Formularz lub API odrzuca zgłoszenie z komunikatem walidacji lub oznacza wpis ostrzeżeniem o zbyt krótkim opisie. |

## Technologie użyte w projekcie

- **Backend:** Python 3.14, FastAPI, Uvicorn, SQLAlchemy, Alembic, Pydantic, PyJWT, Argon2 (`argon2-cffi`)
- **Baza danych:** PostgreSQL 17 (produkcja / Docker), SQLite (testy izolowane)
- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS, React Hook Form, Zod
- **Testy i jakość:** Pytest, Starlette TestClient / httpx, Playwright
- **Konteneryzacja:** Docker, Docker Compose
