require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB error:', err));

// 2. Contract Schema
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

// 3. API Generation Endpoint using Native Gemini REST Call
app.post('/api/contracts/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not defined in environment variables' });
    }

    const systemPrompt = `You are an API Architect. Convert this requirement into a REST API specification and mock response: "${prompt}".

Output strictly valid JSON with no markdown formatting or code blocks:
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const aiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      return res.status(500).json({ 
        error: 'Gemini API Error', 
        details: aiData.error?.message || JSON.stringify(aiData) 
      });
    }

    const textOutput = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Model output parsing error', raw: textOutput });
    }

    const parsed = JSON.parse(jsonMatch[0]);

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

// 4. Get List of Saved Contracts
app.get('/api/contracts', async (req, res) => {
  try {
    const contracts = await Contract.find().sort({ createdAt: -1 }).limit(20);
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load contracts' });
  }
});

// 5. Delete a Contract
app.delete('/api/contracts/:id', async (req, res) => {
  try {
    await Contract.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// 6. Dynamic Mock Engine
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