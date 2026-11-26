shader_type spatial;
render_mode cull_disabled, specular_disabled;

void vertex() {
	vec3 position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float sweep = sin(position.x * 0.77 + position.z * 0.92 - TIME * 1.65);
	float flutter = sin(position.x * 4.9 - position.z * 3.1 + TIME * 2.5);
	float tip = UV.y * UV.y;
	VERTEX.x += (sweep * 0.024 + flutter * 0.008) * tip;
	VERTEX.z += sweep * 0.011 * tip;
	NORMAL = normalize(vec3(NORMAL.x * 0.32, 0.9, NORMAL.z * 0.32));
}

void fragment() {
	vec3 color = COLOR.rgb * 1.16;
	ALBEDO = OUTPUT_IS_SRGB ? pow(color, vec3(1.0 / 2.2)) : color;
	ROUGHNESS = 1.0;
}
