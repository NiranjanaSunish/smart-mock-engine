require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB error:', err));

// 2. Schema: Stores Contract & Live Mock Data
const ContractSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  method: { type: String, enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
  endpointPath: { type: String, required: true, unique: true }, // e.g. "checkout", "users-profile"
  statusCode: { type: Number, default: 200 },
  requestSchema: mongoose.Schema.Types.Mixed,
  mockResponse: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

const Contract = mongoose.model('Contract', ContractSchema);

// 3. Gemini Setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 4. API Generation Endpoint
app.post('/api/contracts/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const aiPrompt = `You are a Principal API Architect. Design a production-grade REST API endpoint specification and realistic mock response based on this requirement: "${prompt}".
    Ensure the endpointPath is a clean URL slug without leading slashes (e.g., 'orders/checkout' or 'products/inventory').
    Generate realistic, diverse mock data with 2-4 nested entities.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: aiPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Short descriptive title" },
            method: { type: Type.STRING, enum: ["GET", "POST", "PUT", "DELETE"] },
            endpointPath: { type: Type.STRING, description: "URL slug, e.g., 'payments/verify'" },
            statusCode: { type: Type.INTEGER, description: "HTTP status code, e.g., 200 or 201" },
            requestSchema: { 
              type: Type.OBJECT, 
              description: "JSON schema of expected request body (empty object if GET)",
              properties: {
                fields: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            },
            mockResponse: { 
              type: Type.STRING, 
              description: "A stringified JSON object representing a realistic production mock payload" 
            }
          },
          required: ["title", "method", "endpointPath", "statusCode", "mockResponse"]
        }
      }
    });

    const parsed = JSON.parse(response.text);
    
    // Normalize path and parse response payload
    const cleanedPath = parsed.endpointPath.replace(/^\/+/, '').toLowerCase();
    const mockData = JSON.parse(parsed.mockResponse);

    // Upsert contract so re-generating the same endpoint updates cleanly
    const contract = await Contract.findOneAndUpdate(
      { endpointPath: cleanedPath },
      {
        title: parsed.title,
        description: prompt,
        method: parsed.method,
        endpointPath: cleanedPath,
        statusCode: parsed.statusCode || 200,
        requestSchema: parsed.requestSchema || {},
        mockResponse: mockData
      },
      { upsert: true, new: true }
    );

    res.status(201).json(contract);
  } catch (error) {
    console.error('Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate contract', details: error.message });
  }
});

// 5. Get List of Saved Contracts
app.get('/api/contracts', async (req, res) => {
  const contracts = await Contract.find().sort({ createdAt: -1 }).limit(20);
  res.json(contracts);
});

// 6. Delete a Contract
app.delete('/api/contracts/:id', async (req, res) => {
  await Contract.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// 7. Dynamic Mock Engine (Catch-All Mock Runner)
// Matches any call to /api/mock/* and serves the persisted mock payload
app.all('/api/mock/*', async (req, res) => {
  try {
    const rawPath = req.params[0]?.toLowerCase();
    const contract = await Contract.findOne({ endpointPath: rawPath });

    if (!contract) {
      return res.status(404).json({
        error: 'Mock endpoint not found',
        requestedPath: rawPath,
        hint: 'Generate this contract first from the dashboard.'
      });
    }

    // Optional: Return warning if method does not match
    if (req.method !== contract.method) {
      return res.status(405).json({
        error: `Method Not Allowed. Expected ${contract.method}, received ${req.method}`
      });
    }

    res.status(contract.statusCode).json(contract.mockResponse);
  } catch (err) {
    res.status(500).json({ error: 'Mock serving error', details: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Smart Mock Server live on port ${PORT}`));