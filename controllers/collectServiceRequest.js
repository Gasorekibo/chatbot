
const ServiceRequest = require('../models/ServiceRequest'); 

const collectServiceRequest = async (req, res) => {
  const { 
    service,
    name,
    email,
    phone,
    company,
    details,
    timeline,
    budget,
    module, 
    appType, 
    trainingTopic,
    participants
  } = req.body;

  if (!service || !name || !email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const request = await ServiceRequest.create({
      service,
      name,
      email,
      phone: phone || null,
      company: company || null,
      details: details || "",
      timeline: timeline || null,
      budget: budget || null,
      sapModule: module || null,
      appType: appType || null,
      trainingTopic: trainingTopic || null,
      participants: participants || null,
      status: 'new',
      createdAt: new Date()
    });

    res.json({
      success: true,
      message: "Request saved! Our team will review it shortly.",
      requestId: request._id
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to save request" });
  }
};

module.exports = collectServiceRequest;