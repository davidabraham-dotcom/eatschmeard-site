// Netlify serverless function to handle waitlist signups via Brevo API
export default async (req) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { email, phone } = await req.json();

    // Validate email
    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const BREVO_API_KEY = Netlify.env.get("BREVO_API_KEY");
    if (!BREVO_API_KEY) {
      console.error("BREVO_API_KEY not set");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build the contact payload for Brevo
    const contactData = {
      email: email,
      listIds: [3], // Waitlist list ID
      updateEnabled: true, // Update if contact already exists
      attributes: {},
    };

    // Add phone (SMS) if provided
    if (phone && phone.trim()) {
      contactData.attributes.SMS = phone.trim();
    }

    // Call Brevo API to create/update contact
    const response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify(contactData),
    });

    const result = await response.json();

    if (response.ok || response.status === 204) {
      return new Response(JSON.stringify({ success: true, message: "You're on the list!" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle "Contact already exist" as success (they're already signed up)
    if (result.code === "duplicate_parameter") {
      return new Response(JSON.stringify({ success: true, message: "You're already on the list!" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("Brevo API error:", JSON.stringify(result));
    return new Response(JSON.stringify({ error: "Signup failed. Please try again." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/signup",
};
