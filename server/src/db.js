import mongoose from 'mongoose';
import config from './config.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri, {
    dbName: config.mongodbDb,
    serverSelectionTimeoutMS: 10_000,
  });
  return mongoose.connection;
}
