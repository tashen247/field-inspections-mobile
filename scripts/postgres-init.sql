-- Local development: a second database for the integration tests.
CREATE DATABASE fim_test OWNER fim;
\c fim
CREATE EXTENSION IF NOT EXISTS postgis;
\c fim_test
CREATE EXTENSION IF NOT EXISTS postgis;
