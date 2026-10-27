import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  visible: boolean;
  tripId: string;
  headers: Record<string, string>;
  onClose: () => void;
  styles: Record<string, any>;
};

// The public page (and its web fonts) is only needed once a preview is opened, so it is loaded then.
const PublicPage = (props: { preview: { tripId: string; headers: Record<string, string> } }) => {
  const Page = require('./PublicTripBlogPage').default as React.ComponentType<{ username: string; tripSlug: string; preview: { tripId: string; headers: Record<string, string> } }>;
  return <Page username="" tripSlug="" preview={props.preview} />;
};

/**
 * The public blog page, shown to a signed-in traveler of the trip before (or without) publication.
 * It is the same renderer the public sees; the only differences are where the document comes from
 * and that nothing in it records a reaction.
 */
const BlogPublicPreview: React.FC<Props> = ({ visible, tripId, headers, onClose, styles }) => (
  <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View testID="blog-public-preview">
      <Text testID="blog-public-preview-banner" style={styles.sectionTitle}>Preview: this is how the public will see your blog. Only travelers on this trip can see this preview.</Text>
      <TouchableOpacity testID="blog-public-preview-close" accessibilityRole="button" style={styles.button} onPress={onClose}>
        <Text style={styles.buttonText}>Close preview</Text>
      </TouchableOpacity>
    </View>
    <ScrollView>
      {visible ? <PublicPage preview={{ tripId, headers }} /> : null}
    </ScrollView>
  </Modal>
);

export default BlogPublicPreview;
