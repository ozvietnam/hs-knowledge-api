import { google } from '@ai-sdk/google';
import { streamText } from 'ai';

// Đặt thời gian chạy tối đa là 30s
export const maxDuration = 30;

export async function POST(req) {
  try {
    const { messages } = await req.json();

    // 1. Phân tích ngữ cảnh user đang hỏi bằng cách lấy câu hỏi cuối cùng
    const latestMessage = messages[messages.length - 1]?.content;

    let hsContext = '';

    // Lấy link API từ biến môi trường
    const apiUrl = process.env.HS_API_URL || 'https://hs-knowledge-api.vercel.app';

    // 2. Fetch dữ liệu từ hs-knowledge-api qua API Search
    // Ta truyền trực tiếp câu hỏi (limit 3 kết quả sát nhất)
    if (latestMessage && latestMessage.length > 2) {
      try {
        const searchRes = await fetch(`${apiUrl}/api/search?q=${encodeURIComponent(latestMessage)}&limit=3`);
        if (searchRes.ok) {
          const data = await searchRes.json();
          if (data && data.results && data.results.length > 0) {
            hsContext = JSON.stringify(data.results, null, 2);
          }
        }
      } catch (err) {
        console.error('Error fetching HS Data', err);
      }
    }

    // 3. Chuẩn bị System Prompt
    const systemPrompt = `
      Bạn là AI chuyên gia tư vấn mã HS quốc tế và biểu thuế XNK của Việt Nam.
      Người dùng sẽ hỏi bạn về các mã HS, cách phân loại hoặc thuế suất của 1 sản phẩm.
      ĐÂY LÀ DỮ LIỆU TỪ CƠ SỞ DỮ LIỆU CỦA VIỆT NAM (JSON API - Kiến trúc 9 tầng) trích xuất dựa trên câu hỏi của họ:
      <HS_DATA>
      ${hsContext ? hsContext : 'Không có dữ liệu tĩnh nào khớp hoàn toàn ở hệ thống hiện tại. Hãy dựa vào hiểu biết của bạn để trả lời và gợi ý hỏi thêm nếu cần chi tiết hơn.'}
      </HS_DATA>

      Nhiệm vụ của bạn:
      - Sử dụng dữ liệu trong thẻ <HS_DATA> nếu có để đưa ra câu trả lời chính xác nhất.
      - Trả lời bằng tiếng Việt, giọng văn chuyên nghiệp, nhiệt tình, dễ hiểu. Trình bày dùng Markdown cho rõ ràng, chia luồng gọn gàng.
      - Nêu bật Mã HS (Chapter, Heading, Subheading, 8-digit nếu có).
      - Đề cập mức thuế, luật (Legal Layer, Regulatory layer), và cảnh báo Mâu thuẫn (Conflict layer) nếu nó có nằm trong <HS_DATA>.
      - Khuyến khích user cung cấp thông tin chất liệu chi tiết nếu chưa đủ dữ kiện để áp mã HS chính xác.
    `;

    // 4. Stream dữ liệu từ LLM trả về Frontend
    // Sử dụng Gemini 1.5 Pro hoặc mới hơn, Vercel AI SDK mapping nó tên là 'gemini-1.5-pro-latest' hoặc 'gemini-1.5-pro' tùy version, ta dể 'gemini-1.5-pro'
    const result = streamText({
      model: google('gemini-1.5-pro-latest'), 
      system: systemPrompt,
      messages,
      temperature: 0.2, // Giảm temperature để trả lời mã luật chính xác
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Error in chat route:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
