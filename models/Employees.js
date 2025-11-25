import mongoose from 'mongoose';
import CryptoJS from 'crypto-js';

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  refreshToken: { type: String },
});

employeeSchema.pre('save', function (next) {
  if (this.refreshToken) {
    this.refreshToken = CryptoJS.AES.encrypt(
      this.refreshToken,
      process.env.ENCRYPTION_KEY
    ).toString();
  }
  next();
});

employeeSchema.methods.getDecryptedToken = function () {
  if (!this.refreshToken) return null;
  const bytes = CryptoJS.AES.decrypt(this.refreshToken, process.env.ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

const Employee = mongoose.model('Employee', employeeSchema);
export default Employee;