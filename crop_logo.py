from PIL import Image
import os

img = Image.open('safety-logo-v2.png').convert("RGBA")
bbox = img.getbbox()
if bbox:
    cropped = img.crop(bbox)
    cropped.save('safety-logo-v2.png')
    print("Cropped successfully!")
else:
    print("No bounding box found.")
