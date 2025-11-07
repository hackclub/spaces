import knex from 'knex';
import dotenv from 'dotenv';

dotenv.config();  

const pg = knex({
  client: 'pg',
  connection: process.env.PG_CONNECTION_STRING,
  searchPath: ['knex', 'public'],
});

console.log("Connected to PostgreSQL database");

export default pg;
    