# 🚀 Руководство по развертыванию btools на VPS и хостинге

В данном руководстве описаны все варианты развертывания экосистемы **btools** на виртуальном сервере (VPS/VDS) под управлением Linux (Ubuntu/Debian) или на классическом статическом хостинге.

---

## Вариант 1. Развертывание с Node.js и PM2 (Рекомендуется)

Этот способ обеспечивает работу статических файлов и встроенного REST API для сохранения и загрузки пользовательских пресетов.

### Шаг 1. Подготовка сервера
Подключитесь к VPS по SSH и установите Node.js (версии 18 LTS или выше):

```bash
# Обновление пакетов
sudo apt update && sudo apt upgrade -y

# Установка Node.js (через NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Установка менеджера процессов PM2
sudo npm install -g pm2
```

### Шаг 2. Клонирование репозитория
```bash
cd /var/www
sudo git clone https://github.com/Evgeny-Bondarov/btools.git
cd btools
sudo git checkout 1.0-alpha
```

### Шаг 3. Запуск сервера через PM2
```bash
# Запуск через PM2 с автоперезапуском при сбоях
pm2 start server.js --name "btools"

# Настройка автозапуска PM2 при перезагрузке ОС
pm2 startup
pm2 save
```

Сервер запустится на порту `8080`.

---

## Вариант 2. Настройка Nginx с бесплатным SSL (Let's Encrypt)

Для открытия инструментов по доменному имени (например, `btools.yourdomain.com`) и по безопасному протоколу HTTPS:

### Шаг 1. Установка Nginx и Certbot
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Шаг 2. Конфигурация виртуального хоста Nginx
Создайте файл конфигурации:
```bash
sudo nano /etc/nginx/sites-available/btools
```

Вставьте следующее содержимое:

```nginx
server {
    server_name btools.yourdomain.com;

    # Максимальный размер загружаемых файлов для изображений слайдов
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Кэширование статических ассетов
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|webm)$ {
        proxy_pass http://127.0.0.1:8080;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Активируйте конфигурацию и перезапустите Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/btools /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Шаг 3. Получение бесплатного SSL-сертификата
```bash
sudo certbot --nginx -d btools.yourdomain.com
```

---

## Вариант 3. Развертывание в Docker

В репозитории предусмотрен запуск в изолированном контейнере:

### Шаг 1. Dockerfile
Создайте `Dockerfile` в корне проекта (если еще не создан):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
```

### Шаг 2. Запуск контейнера
```bash
# Сборка образа
docker build -t btools:1.0 .

# Запуск в фоновом режиме с монтированием папки пресетов для персистентности
docker run -d \
  --name btools \
  --restart always \
  -p 8080:8080 \
  btools:1.0
```

---

## Вариант 4. Статический хостинг (GitHub Pages / Vercel / Netlify / Timeweb / Beget)

Если база данных пресетов не требуется (только клиентская часть Three.js и WebGL):

1. Скопируйте содержимое папки `btools/` в корневую директорию сайта (обычно `public_html` или `www`).
2. Вся функциональность мокапов, 3D-кольца, переключения форм, ресайза фокуса, экспорта готового HTML-кода и рендера скриншотов работает автономно в браузере клиента на WebGL 2.0 без серверных зависимостей.
3. Готово!

---

## Полезные команды для обслуживания

```bash
# Просмотр логов сервера
pm2 logs btools

# Перезапуск приложения после обновления кода
cd /var/www/btools && git pull && pm2 restart btools

# Мониторинг нагрузки CPU и ОЗУ
pm2 monit
```
