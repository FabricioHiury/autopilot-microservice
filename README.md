<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://kamilmysliwiec.com)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](LICENSE).

## Sending message

```curl
curl -X POST http://localhost:3003/gerador/enviar-mensagem -H "Content-Type: application/json" -d "{\"numero\": \"553497078196\", \"mensagem\": \"test\"}"
```

## Chat Info

```
curl --request GET --url "http://localhost:3003/wpp/chat-info?tokenDispositivo=722124a1-554c-493c-a993-a102c25bb9ea&numero=553497078196&numeroMensagens=10" --header "Content-Type: application/json" --header "x-api-key: l8KUiUixbmgfbrKGAyTVunkRMdkRl7_T_Zi4ktTiR-k"
```

## Pegando mensagens

```
curl --request GET --url "http://localhost:3003/wpp/chat-msgs?tokenDispositivo=722124a1-554c-493c-a993-a102c25bb9ea&numero=5561936180795&numeroMensagens=10&de=1700000000&ate=1700005000" --header "Content-Type: application/json" --header "x-api-key: l8KUiUixbmgfbrKGAyTVunkRMdkRl7_T_Zi4ktTiR-k"
```

```
curl -X GET "http://localhost:3003/consumidor/chat-msgs?numero=553497078196&numeroMensagens=10" -H "accept: application/json"
```

## Todos os chats

```
curl -X GET "http://localhost:3003/wpp/todos-chats?tokenDispositivo=722124a1-554c-493c-a993-a102c25bb9ea" -H "accept: application/json" -H "x-api-key: l8KUiUixbmgfbrKGAyTVunkRMdkRl7_T_Zi4ktTiR-k"
```

## Insights

1. Salvar dispositivo
2. Salvar contatos (isGroup === false)
3. Filtrar novos contatos.
4. Banco pra persistir todas as mensagens de um contato.

5. Filtro data inicial, data final
6. Conteúdo das mensagens

## Todo

1. Endpoint de validação externa OLX
2. Redirecionamento

## Fluxo autenticação OLX

1. Endpoint pra solicitar URL redirecionamento, considerar id do usuário e id da loja e o `client_id`

```
https://auth.olx.com.br/oauth?client_id=​1055d3e698d289f2af8663725127bd4b&redirect_uri=https://yourserver.com/token&response_type=code&scope=autoupload&state=/profile
```

https://yourserver.com/:userId/token

Cookie


2. Endpoint pro callback da autenticação (verificar parâmetros a serem armazenados), no parâmetro de redirecionamento, deverá ser passado o endereço da api. Salvar em memória o código de acesso `code`.
3. Enviar para api olx requisição para troca do code pelo access token (bearer). Informar no redirecionamento a url da própria api. Ao receber o callback, salvar o access token no banco de dados