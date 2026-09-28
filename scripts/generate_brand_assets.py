import os
import shutil
from PIL import Image

SRC_PATH = r"C:\Users\tawfi\.gemini\antigravity\brain\aa9fb0a1-d554-4cfa-9aad-a73fdb4f7e61\.user_uploaded\media_1790539244386.png"
PUBLIC_DIR = r"e:\توفيق\zid\zidlink2\public"
APP_DIR = r"e:\توفيق\zid\zidlink2\src\app"

os.makedirs(PUBLIC_DIR, exist_ok=True)

# 1. Copy original file
shutil.copy2(SRC_PATH, os.path.join(PUBLIC_DIR, "logo-original.png"))

# 2. Open and prepare transparency
img = Image.open(SRC_PATH).convert("RGB")
w, h = img.size

def make_transparent(source_img, dark_mode=False):
    sw, sh = source_img.size
    out = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    for y in range(sh):
        for x in range(sw):
            r, g, b = source_img.getpixel((x, y))
            diff = max(255 - r, 255 - g, 255 - b)
            if diff <= 6:
                alpha = 0
                cr, cg, cb = 0, 0, 0
            elif diff < 35:
                alpha_f = (diff - 6) / (35 - 6)
                alpha = int(alpha_f * 255)
                a_val = alpha_f
                cr = max(0, min(255, int((r - 255 * (1 - a_val)) / a_val)))
                cg = max(0, min(255, int((g - 255 * (1 - a_val)) / a_val)))
                cb = max(0, min(255, int((b - 255 * (1 - a_val)) / a_val)))
            else:
                alpha = 255
                cr, cg, cb = r, g, b
            
            if alpha > 0 and dark_mode:
                # If dark mode, transform dark navy to white / light blue-white
                # Check darkness: brightness = 0.299*r + 0.587*g + 0.114*b
                # Blue/cyan has high green/blue, navy is low in all
                # If r < 60 and g < 110 and b < 160:
                is_navy = (cr < 65 and cg < 115 and cb < 165)
                if is_navy:
                    # Map navy (cr ~ 10, cg ~ 65, cb ~ 115) to white / bright silver (245, 250, 255)
                    # Use smooth blending based on how dark it is
                    factor = min(1.0, max(0.0, (150 - cb) / 60.0))
                    target_r = int(245 * factor + cr * (1 - factor))
                    target_g = int(250 * factor + cg * (1 - factor))
                    target_b = int(255 * factor + cb * (1 - factor))
                    cr, cg, cb = target_r, target_g, target_b
            
            out.putpixel((x, y), (cr, cg, cb, alpha))
    return out

print("Processing transparent light logo...")
trans_light = make_transparent(img, dark_mode=False)
bbox = trans_light.getbbox()
# Add subtle 4px padding
pad = 6
crop_box = (
    max(0, bbox[0] - pad),
    max(0, bbox[1] - pad),
    min(w, bbox[2] + pad),
    min(h, bbox[3] + pad)
)
logo_light = trans_light.crop(crop_box)
logo_light.save(os.path.join(PUBLIC_DIR, "logo.png"), "PNG")
print("Saved public/logo.png")

print("Processing transparent dark logo...")
trans_dark = make_transparent(img, dark_mode=True)
logo_dark = trans_dark.crop(crop_box)
logo_dark.save(os.path.join(PUBLIC_DIR, "logo-dark.png"), "PNG")
print("Saved public/logo-dark.png")

# 3. Extract Cart Icon (y from 0 to 225)
cart_crop_box = (
    max(0, bbox[0] - pad),
    max(0, bbox[1] - pad),
    min(w, bbox[2] + pad),
    225
)
cart_icon_light = trans_light.crop(cart_crop_box)
cart_icon_dark = trans_dark.crop(cart_crop_box)

# Make icon square with centered placement
def make_square_icon(cropped_icon, size=512):
    iw, ih = cropped_icon.size
    sq = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = (size * 0.85) / max(iw, ih)
    nw = int(iw * scale)
    nh = int(ih * scale)
    resized = cropped_icon.resize((nw, nh), Image.Resampling.LANCZOS)
    sq.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return sq

icon_512_light = make_square_icon(cart_icon_light, 512)
icon_512_light.save(os.path.join(PUBLIC_DIR, "logo-icon.png"), "PNG")
icon_512_dark = make_square_icon(cart_icon_dark, 512)
icon_512_dark.save(os.path.join(PUBLIC_DIR, "logo-icon-dark.png"), "PNG")
print("Saved public/logo-icon.png and public/logo-icon-dark.png")

# 4. Extract Text part (y from 235 to end)
text_crop_box = (
    max(0, bbox[0] - pad),
    235,
    min(w, bbox[2] + pad),
    min(h, bbox[3] + pad)
)
text_light = trans_light.crop(text_crop_box)
text_dark = trans_dark.crop(text_crop_box)

# 5. Create Horizontal Logo [Cart Icon] + [Text]
def make_horizontal(cart_img, text_img, target_h=120):
    cw, ch = cart_img.size
    tw, th = text_img.size
    
    # Scale cart to target_h * 0.95
    cart_h = int(target_h * 0.95)
    cart_w = int(cw * (cart_h / ch))
    r_cart = cart_img.resize((cart_w, cart_h), Image.Resampling.LANCZOS)
    
    # Scale text to target_h * 0.65 (so it matches visually)
    text_h = int(target_h * 0.62)
    text_w = int(tw * (text_h / th))
    r_text = text_img.resize((text_w, text_h), Image.Resampling.LANCZOS)
    
    gap = 20
    total_w = cart_w + gap + text_w
    h_img = Image.new("RGBA", (total_w, target_h), (0, 0, 0, 0))
    
    # Vertically center both
    h_img.paste(r_cart, (0, (target_h - cart_h) // 2), r_cart)
    h_img.paste(r_text, (cart_w + gap, (target_h - text_h) // 2), r_text)
    return h_img

h_light = make_horizontal(cart_icon_light, text_light)
h_light.save(os.path.join(PUBLIC_DIR, "logo-horizontal.png"), "PNG")
h_dark = make_horizontal(cart_icon_dark, text_dark)
h_dark.save(os.path.join(PUBLIC_DIR, "logo-horizontal-dark.png"), "PNG")
print("Saved public/logo-horizontal.png and public/logo-horizontal-dark.png")

# 6. Generate Favicon & App Icons
# Windows ICO format supports multiple sizes: 16, 32, 48, 64
icon_512_light.save(
    os.path.join(PUBLIC_DIR, "favicon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
)
icon_512_light.save(
    os.path.join(APP_DIR, "favicon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
)

# App router metadata icons
icon_32 = icon_512_light.resize((32, 32), Image.Resampling.LANCZOS)
icon_32.save(os.path.join(APP_DIR, "icon.png"), "PNG")

icon_192 = icon_512_light.resize((192, 192), Image.Resampling.LANCZOS)
icon_192.save(os.path.join(PUBLIC_DIR, "favicon-192.png"), "PNG")

apple_icon = icon_512_light.resize((180, 180), Image.Resampling.LANCZOS)
apple_icon.save(os.path.join(APP_DIR, "apple-icon.png"), "PNG")
apple_icon.save(os.path.join(PUBLIC_DIR, "apple-touch-icon.png"), "PNG")

print("All brand assets generated successfully!")
