require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

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
  endpointPath: { type: String, required: true, unique: true },
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

    console.log('Generating contract for prompt:', prompt);

    const systemPrompt = `You are an API Architect. Convert this requirement into a REST API specification and mock response: "${prompt}".

Return ONLY a valid JSON object without markdown fences, formatted exactly as:
{
  "title": "Endpoint Title",
  "method": "POST",
  "endpointPath": "orders/checkout",
  "statusCode": 200,
  "requestSchema": {
    "fields": ["items", "couponCode"]
  },
  "mockResponse": {
    "orderId": "ORD-98213",
    "status": "confirmed",
    "total": 129.50
  }
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: systemPrompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    // Safely extract text from response object across SDK versions
    let rawText = '';
    if (typeof response.text === 'function') {
      rawText = response.text();
    } else if (typeof response.text === 'string') {
      rawText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      rawText = response.candidates[0].content.parts[0].text;
    }

    console.log('Gemini raw output:', rawText);

    // Extract JSON substring cleanly (handles backticks or unexpected lead-in text)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Model returned non-JSON text: ${rawText.slice(0, 100)}...`);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize endpointPath
    const cleanedPath = (parsed.endpointPath || 'sample-endpoint')
      .replace(/^\/+/, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    const contract = await Contract.findOneAndUpdate(
      { endpointPath: cleanedPath },
      {
        title: parsed.title || 'Generated API',
        description: prompt,
        method: (parsed.method || 'GET').toUpperCase(),
        endpointPath: cleanedPath,
        statusCode: parsed.statusCode || 200,
        requestSchema: parsed.requestSchema || {},
        mockResponse: parsed.mockResponse || { message: 'Sample output' }
      },
      { upsert: true, new: true }
    );

    res.status(201).json(contract);
  } catch (error) {
    console.error('Generation Error Detail:', error);
    res.status(500).json({
      error: 'Failed to generate contract',
      details: error.message || String(error)
    });
  }
});

// 5. Get List of Saved Contracts
app.get('/api/contracts', async (req, res) => {
  try {
    const contracts = await Contract.find().sort({ createdAt: -1 }).limit(20);
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load contracts' });
  }
});

// 6. Delete a Contract
app.delete('/api/contracts/:id', async (req, res) => {
  try {
    await Contract.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// 7. Dynamic Mock Engine (Catch-All Mock Runner)
app.all('/api/mock/{*splat}', async (req, res) => {
  try {
    const rawPath = (req.params.splat || '').replace(/^\/+/, '').toLowerCase();
    const contract = await Contract.findOne({ endpointPath: rawPath });

    if (!contract) {
      return res.status(404).json({
        error: 'Mock endpoint not found',
        requestedPath: rawPath,
        hint: 'Generate this contract first from the dashboard.'
      });
    }

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