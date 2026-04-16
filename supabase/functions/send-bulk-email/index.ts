import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getValidAccessToken(supabase: any, connection: any): Promise<string> {
  const tokenExpiry = new Date(connection.access_token_expires_at);
  const bufferMs = 5 * 60 * 1000;

  if (tokenExpiry.getTime() - bufferMs > Date.now()) {
    return connection.access_token;
  }

  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") || Deno.env.get("GMAIL_CLIENT_ID") || "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || Deno.env.get("GMAIL_CLIENT_SECRET") || "",
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshResponse.ok) {
    const errText = await refreshResponse.text();
    throw new Error(`Failed to refresh access token: ${errText}`);
  }

  const refreshData = await refreshResponse.json();
  const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

  await supabase
    .from("gmail_connections")
    .update({
      access_token: refreshData.access_token,
      access_token_expires_at: newExpiry,
    })
    .eq("id", connection.id);

  return refreshData.access_token;
}

function encodeEmailRFC2822(
  fromEmail: string,
  fromName: string,
  toEmail: string,
  subject: string,
  htmlBody: string
): string {
  const fromField = fromName
    ? `=?utf-8?B?${btoa(unescape(encodeURIComponent(fromName)))}?= <${fromEmail}>`
    : fromEmail;

  const encodedSubject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

  const lines = [
    `From: ${fromField}`,
    `To: ${toEmail}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(htmlBody))),
  ];

  const raw = lines.join("\r\n");
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, toEmails, subject, body, contactId, senderName, isHtml } = await req.json();

    if (!userId || !toEmails || !subject || !body) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: connection, error: connectionError } = await supabase
      .from("gmail_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_connected", true)
      .maybeSingle();

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ success: false, error: "Gmail not connected. Please connect Gmail in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getValidAccessToken(supabase, connection);

    const recipientEmails: string[] = Array.isArray(toEmails) ? toEmails : [toEmails];
    const toField = recipientEmails.join(", ");

    const htmlContent = isHtml
      ? body
      : `<html><body><pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre></body></html>`;

    const encodedEmail = encodeEmailRFC2822(
      connection.email_address,
      senderName || "",
      toField,
      subject,
      htmlContent
    );

    const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedEmail }),
    });

    if (!sendResponse.ok) {
      const errorData = await sendResponse.text();
      console.error("Gmail API error:", errorData);
      throw new Error(`Gmail API error: ${errorData}`);
    }

    const result = await sendResponse.json();

    return new Response(
      JSON.stringify({ success: true, messageId: result.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error sending email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to send email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
