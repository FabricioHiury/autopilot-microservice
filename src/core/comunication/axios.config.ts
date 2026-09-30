import { Logger } from '@nestjs/common';
import axios from 'axios';
import axiosRetry from 'axios-retry';

const logger = new Logger('AxiosRetry');

const createAxiosWithRetry = (baseURL: string, apiKey: string) => {
  const instance = axios.create({
    baseURL,
    timeout: 8000,
    headers: {
      'x-api-key': apiKey,
    },
  });

  axiosRetry(instance, {
    retries: 5,
    retryDelay: (retryCount) => {
      const delayBase = 1000;
      const delayMax = 30 * 1000;
      const delay = Math.min(delayBase * 2 ** retryCount, delayMax);
      const jitter = delay * 0.5 * Math.random();

      logger.warn(`Tentativa #${retryCount} para ${baseURL}`);
      logger.log(`Reagendando tentativa em ${delay + jitter}ms`);
      return delay + jitter;
    },
    retryCondition: (error) => {
      logger.error(`Erro na comunicação com ${baseURL}: ${error?.message}`);
      return (
        axiosRetry.isNetworkError(error) ||
        (error.response && error.response.status >= 500)
      );
    },
  });

  instance.interceptors.request.use((config) => {
    logger.log(`[Request] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    return config;
  });

  instance.interceptors.response.use(
    (resp) => resp,
    (error) => {
      logger.error(`[Response Error] ${error.config?.url} - ${error.message}`, {
        status: error.response?.status,
        code: error.code,
      });
      return Promise.reject(error);
    },
  );

  return instance;
};

export const axiosAutoPilotRetry = createAxiosWithRetry(
  process.env.AUTOPILOT_URL!,
  process.env.API_KEY!,
);

export const axiosIntegracaoRetry = createAxiosWithRetry(
  process.env.AUTOPILOT_URL!,
  process.env.API_KEY!,
);