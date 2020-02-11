FROM node:12-alpine

RUN apk --no-cache add python3

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install -r requirements.txt

COPY package.json yarn.lock ./
RUN yarn install

COPY .env.example tsconfig.json README.md ./
COPY src ./src
RUN yarn tsc

CMD ["node", "."]